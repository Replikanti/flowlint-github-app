import 'dotenv/config';
// Initialize tracing BEFORE any other imports that need instrumentation
import { setupWorkerTracing } from './tracing';
setupWorkerTracing().catch((error) => console.error('Failed to initialize tracing:', error));

import { Worker, Job } from 'bullmq';
import { getInstallationClient } from '../../../packages/github/client';
import { loadConfigFromGitHub } from '../../../packages/github/config-loader';
import { pickTargets, fetchRawFiles } from '../../../packages/github/sniffer';
import { parseN8n } from '@replikanti/flowlint-core';
import { ValidationError } from '@replikanti/flowlint-core';
import { runAllRules } from '@replikanti/flowlint-core';
import { buildCheckOutput, buildAnnotations } from '@replikanti/flowlint-core';
import { getExampleLink } from '@replikanti/flowlint-core';
import type { ReviewJob } from '../../api/src/queue';
import type { Finding } from '@replikanti/flowlint-core';
import { Octokit } from 'octokit';
import { logger, createChildLogger } from '../../../packages/logger';
import {
  jobsCompletedCounter,
  jobDurationHistogram,
  findingsGeneratedCounter,
} from '../../../packages/observability';
import { withSpan, SpanNames, setSpanAttributes, recordSpanException } from '../../../packages/tracing';

const BATCH_SIZE = 50;

const connection = {
  connection: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
};

/**
 * Helper function to update a GitHub Check Run status
 * Eliminates code duplication across worker
 */
async function updateCheckRun(
  gh: Octokit,
  owner: string,
  repo: string,
  checkRunId: number,
  params: {
    status?: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'skipped';
    output?: {
      title: string;
      summary: string;
      text?: string;
      annotations?: any[];
    };
    completed_at?: string;
    started_at?: string;
  },
): Promise<void> {
  try {
    await gh.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
      owner,
      repo,
      check_run_id: checkRunId,
      ...params,
    });
    logger.info({ checkRunId, status: params.status, annotationCount: params.output?.annotations?.length }, 'check run updated successfully');
  } catch (error) {
    logger.error({ checkRunId, error, params: { status: params.status, hasAnnotations: !!params.output?.annotations?.length } }, 'failed to update check run');
    throw error;
  }
}

function assertCheckRunId(value: number | undefined): number {
  if (typeof value !== 'number') {
    throw new Error('FlowLint check run was not initialized');
  }
  return value;
}

function formatParseError(error: unknown): string | undefined {
  if (error instanceof ValidationError && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors
      .map((err: { path: string; message: string; suggestion?: string }) => {
        const suggestion = err.suggestion ? ` (suggestion: ${err.suggestion})` : '';
        return `- ${err.path}: ${err.message}${suggestion}`;
      })
      .join('\n')
      .slice(0, 64000);
  }

  if (error instanceof Error && error.stack) {
    return error.stack.slice(0, 64000);
  }

  return undefined;
}

const worker = new Worker<ReviewJob>(
  'review',
  async (job: Job<ReviewJob>) => {
    const { installationId, repo, prNumber, sha, checkSuiteId } = job.data;
    const [owner, name] = repo.split('/');

    // Create child logger with job context for correlation
    const jobLogger = createChildLogger({
      jobId: job.id,
      repo,
      prNumber,
      sha: sha.substring(0, 7), // Short SHA for readability
    });

    jobLogger.info('processing review job');

    // Start timer for job duration
    const timer = jobDurationHistogram.startTimer({ repo });

    let gh: Octokit;
    let checkRunId: number | undefined;
    let previousRuns: any[] = [];

    try {
      gh = await getInstallationClient(installationId);

      // Collect existing FlowLint check runs (if any) so we can supersede them later
      const { data: commitChecks } = await gh.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
        owner,
        repo: name,
        ref: sha,
      });
      previousRuns = commitChecks.check_runs?.filter(
        (run: any) => run.name === (process.env.CHECK_NAME || 'FlowLint') && run.head_sha === sha,
      ) ?? [];

      // Always create a brand new check run for this execution
      const { data: check } = await gh.request('POST /repos/{owner}/{repo}/check-runs', {
        owner,
        repo: name,
        name: process.env.CHECK_NAME || 'FlowLint',
        head_sha: sha,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        check_suite_id: checkSuiteId,
      });
      checkRunId = check.id;

      const paginate = (gh as Octokit & { paginate?: Octokit['paginate'] }).paginate;
      if (typeof paginate !== 'function') {
        throw new Error('Octokit client is missing paginate(); ensure @octokit/plugin-paginate-rest is registered.');
      }

      // 1. List all files in the PR (paginated)
      const allFiles = await paginate.call(gh, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
        owner,
        repo: name,
        pull_number: prNumber,
        per_page: 100,
      });

      // 2. Load config from GitHub (using helper) and filter for target files
      const cfg = await loadConfigFromGitHub(gh, repo, sha);
      const targets = pickTargets(allFiles, cfg.files);
      const activeCheckRunId = assertCheckRunId(checkRunId);

      jobLogger.info({ totalFiles: allFiles.length, targetCount: targets.length, targetFiles: targets.map((f: any) => f.filename) }, 'files analyzed');
      jobLogger.info({ allFilesMetadata: allFiles.map((f: any) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, changes: f.changes })) }, 'PR file metadata');

      // 3. If no targets, complete the check run as neutral and supersede older runs
      if (targets.length === 0) {
        await updateCheckRun(gh, owner, name, activeCheckRunId, {
          status: 'completed',
          conclusion: 'neutral',
          completed_at: new Date().toISOString(),
          output: {
            title: 'No relevant files found',
            summary: 'No workflow files were found to analyze in this pull request.',
          },
        });

        // Mark older FlowLint runs as superseded even when no files found
        await Promise.all(
          previousRuns.map(async (run) => {
            try {
              await gh.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
                owner,
                repo: name,
                check_run_id: run.id,
                status: 'completed',
                conclusion: 'neutral',
                completed_at: new Date().toISOString(),
                output: {
                  title: 'Superseded by newer FlowLint run',
                  summary: `This run has been replaced by FlowLint check ${checkRunId}. See the latest run for up-to-date findings.`,
                },
              });
            } catch (supersedeError) {
              jobLogger.warn({ error: supersedeError, runId: run.id }, 'failed to mark older run as superseded');
            }
          }),
        );

        // Record successful job completion
        timer();
        jobsCompletedCounter.labels('success', repo).inc();
        return;
      }

      // 4. Fetch, parse, and lint all target files
      const { contents: rawFiles, errors: fetchErrors } = await fetchRawFiles(gh, repo, targets);
      let findings: Finding[] = [];

      // Emit findings for files that failed to fetch
      for (const { filename, error } of fetchErrors) {
        findings.push({
          rule: 'FETCH',
          severity: 'should',
          path: filename,
          message: `Failed to fetch file: ${error}`,
          raw_details: 'This may be due to a force-push, deleted file, or temporary GitHub API issue. Try re-running the check.',
        });
      }

      // Process successfully fetched files
      for (const file of targets) {
        const raw = rawFiles.get(file.filename);
        if (!raw) continue; // Already handled in fetchErrors

        try {
          const graph = parseN8n(raw);
          const rulesResults = runAllRules(graph, {
            path: file.filename,
            cfg,
            nodeLines: graph.meta.nodeLines as Record<string, number> | undefined,
          });

          // Inject documentation URLs into findings
          rulesResults.forEach((f) => {
            f.documentationUrl = getExampleLink(f.rule);
            jobLogger.info({ rule: f.rule, url: f.documentationUrl }, 'injected documentation URL');
          });

          // Track findings generated
          for (const finding of rulesResults) {
            findingsGeneratedCounter.labels(finding.rule, finding.severity).inc();
          }

          findings.push(...rulesResults);
        } catch (error) {
          findings.push({
            rule: 'PARSE',
            severity: 'must',
            path: file.filename,
            message: (error as Error).message,
            raw_details: formatParseError(error),
            line: 1,
          });
        }
      }

      // 5. Build the final output (use ALL findings for conclusion)
      let summaryText: string | undefined;
      if (cfg.report.summary_limit > 0 && findings.length > cfg.report.summary_limit) {
        const { output: tempOutput } = buildCheckOutput({ findings, cfg });
        summaryText = `${tempOutput.summary}\n\n⚠️ Showing first ${cfg.report.summary_limit} annotations of ${findings.length} total findings.`;
      }

      const { conclusion, output } = buildCheckOutput({
        findings,
        cfg,
        summaryOverride: summaryText,
      });

      // 6. Apply summary_limit to annotations only (not to findings count/conclusion)
      const limitedAnnotations =
        cfg.report.summary_limit > 0 && findings.length > cfg.report.summary_limit
          ? buildAnnotations(findings.slice(0, cfg.report.summary_limit))
          : buildAnnotations(findings);

      // 7. Send all annotations in one final update (not batched)
      // GitHub API handles all annotations in a single request better than multiple batches
      if (cfg.report.annotations && limitedAnnotations.length > 0) {
        jobLogger.info({ totalAnnotations: limitedAnnotations.length }, 'sending all annotations in single update');
        jobLogger.info({ sampleAnnotation: JSON.stringify(limitedAnnotations[0]) }, 'sample annotation structure');
        const payload = {
          status: 'completed' as const,
          conclusion,
          completed_at: new Date().toISOString(),
          output: {
            ...output,
            annotations: limitedAnnotations,
          },
        };
        jobLogger.info({ payload: JSON.stringify(payload, null, 2) }, 'full check run update payload');
        await updateCheckRun(gh, owner, name, activeCheckRunId, payload);
      } else {
        // 8. Finalize the check run with the conclusion (no annotations or annotations disabled)
        await updateCheckRun(gh, owner, name, activeCheckRunId, {
          status: 'completed',
          conclusion,
          completed_at: new Date().toISOString(),
          output,
        });
      }

      // Mark older FlowLint runs as superseded now that we have a successful result
      await Promise.all(
        previousRuns.map(async (run) => {
          try {
            await updateCheckRun(gh, owner, name, run.id, {
              status: 'completed',
              conclusion: 'neutral',
              completed_at: new Date().toISOString(),
              output: {
                title: 'Superseded by newer FlowLint run',
                summary: `This run has been replaced by FlowLint check ${activeCheckRunId}. See the latest run for up-to-date findings.`,
              },
            });
          } catch (supersedeError) {
            jobLogger.warn({ error: supersedeError, runId: run.id }, 'failed to mark older run as superseded');
          }
        }),
      );

      // Record successful job completion
      timer(); // Record duration
      jobsCompletedCounter.labels('success', repo).inc();
    } catch (error) {
      jobLogger.error({ error }, 'job failed');

      // Record failed job completion
      timer(); // Record duration even for failures
      jobsCompletedCounter.labels('failure', repo).inc();

      // If something fails, mark the check run as failed
      if (gh && checkRunId) {
        try {
          await updateCheckRun(gh, owner, name, assertCheckRunId(checkRunId), {
            status: 'completed',
            conclusion: 'failure',
            completed_at: new Date().toISOString(),
            output: {
              title: 'FlowLint analysis failed',
              summary: 'An unexpected error occurred while running the analysis.',
              text: (error as Error).stack,
            },
          });
        } catch (updateError) {
          jobLogger.error({ error: updateError }, 'failed to update check run with error state');
        }
      }
      throw error;
    }
  },
  connection,
);

// Graceful shutdown implementation
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.info({ signal }, 'shutdown already in progress, ignoring');
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'received shutdown signal, starting graceful shutdown');
  logger.info('waiting for active jobs to complete (max 45 seconds)');

  try {
    // Close worker gracefully - waits for active jobs to finish
    // BullMQ worker.close() accepts a boolean: false = wait for jobs, true = force close
    // TypeScript doesn't have proper types for close(), but it exists at runtime
    await worker.close();
    logger.info('all active jobs completed, shutdown successful');
  } catch (error) {
    logger.error({ error }, 'error during graceful shutdown');
    throw error;
  }
}

function shutdownAndExit(signal: string, exitCode: number) {
  gracefulShutdown(signal)
    .then(() => process.exit(exitCode))
    .catch(() => process.exit(1));
}

// Handle termination signals
process.on('SIGTERM', () => shutdownAndExit('SIGTERM', 0));
process.on('SIGINT', () => shutdownAndExit('SIGINT', 0));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error: Error) => {
  logger.error({ error }, 'uncaught exception');
  shutdownAndExit('uncaughtException', 1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, 'unhandled rejection');
  shutdownAndExit('unhandledRejection', 1);
});

// Log successful startup
logger.info({
  queue: 'review',
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
}, 'worker started successfully');