import { Job } from 'bullmq';
import { Octokit } from 'octokit';
import { getInstallationClient } from '../../../packages/github/client';
import { loadConfigFromGitHub } from '../../../packages/github/config-loader';
import { pickTargets, fetchRawFiles } from '../../../packages/github/sniffer';
import { 
  parseN8n, 
  ValidationError, 
  runAllRules, 
  buildCheckOutput, 
  buildAnnotations, 
  getExampleLink,
  type Finding 
} from '@replikanti/flowlint-core';
import type { ReviewJob } from '../../api/src/queue';
import { logger, createChildLogger } from '../../../packages/logger';
import {
  jobsCompletedCounter,
  jobDurationHistogram,
  findingsGeneratedCounter,
} from '../../../packages/observability';

/**
 * Helper function to update a GitHub Check Run status
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

export function assertCheckRunId(value: number | undefined): number {
  if (typeof value !== 'number') {
    throw new TypeError('FlowLint check run was not initialized');
  }
  return value;
}

export function formatParseError(error: unknown): string | undefined {
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

async function supersedePreviousRuns(
  gh: Octokit,
  owner: string,
  repo: string,
  activeCheckRunId: number,
  previousRuns: any[],
  jobLogger: any,
) {
  await Promise.all(
    previousRuns.map(async (run) => {
      try {
        await updateCheckRun(gh, owner, repo, run.id, {
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
}

async function handleNoTargets(
  gh: Octokit,
  owner: string,
  repo: string,
  activeCheckRunId: number,
  previousRuns: any[],
  jobLogger: any,
) {
  await updateCheckRun(gh, owner, repo, activeCheckRunId, {
    status: 'completed',
    conclusion: 'neutral',
    completed_at: new Date().toISOString(),
    output: {
      title: 'No relevant files found',
      summary: 'No workflow files were found to analyze in this pull request.',
    },
  });

  await supersedePreviousRuns(gh, owner, repo, activeCheckRunId, previousRuns, jobLogger);
}

async function processTargets(
  gh: Octokit,
  repo: string,
  targets: any[],
  cfg: any,
  jobLogger: any,
): Promise<Finding[]> {
  const { contents: rawFiles, errors: fetchErrors } = await fetchRawFiles(gh, repo, targets);
  const findings: Finding[] = [];

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
    if (!raw) continue;

    try {
      const graph = parseN8n(raw);
      const rulesResults = runAllRules(graph, {
        path: file.filename,
        cfg,
        nodeLines: graph.meta.nodeLines as Record<string, number> | undefined,
      });

      rulesResults.forEach((f) => {
        f.documentationUrl = getExampleLink(f.rule);
        jobLogger.info({ rule: f.rule, url: f.documentationUrl }, 'injected documentation URL');
      });

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
  return findings;
}

async function completeCheckRun(
  gh: Octokit,
  owner: string,
  repo: string,
  activeCheckRunId: number,
  findings: Finding[],
  cfg: any,
  jobLogger: any,
) {
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

  const limitedAnnotations =
    cfg.report.summary_limit > 0 && findings.length > cfg.report.summary_limit
      ? buildAnnotations(findings.slice(0, cfg.report.summary_limit))
      : buildAnnotations(findings);

  if (cfg.report.annotations && limitedAnnotations.length > 0) {
    jobLogger.info({ totalAnnotations: limitedAnnotations.length }, 'sending all annotations in single update');
    const payload = {
      status: 'completed' as const,
      conclusion,
      completed_at: new Date().toISOString(),
      output: {
        ...output,
        annotations: limitedAnnotations,
      },
    };
    await updateCheckRun(gh, owner, repo, activeCheckRunId, payload);
  } else {
    await updateCheckRun(gh, owner, repo, activeCheckRunId, {
      status: 'completed',
      conclusion,
      completed_at: new Date().toISOString(),
      output,
    });
  }
}

export const reviewProcessor = async (job: Job<ReviewJob>) => {
    const { installationId, repo, prNumber, sha, checkSuiteId } = job.data;
    const [owner, name] = repo.split('/');

    const jobLogger = createChildLogger({
      jobId: job.id,
      repo,
      prNumber,
      sha: sha.substring(0, 7),
    });

    jobLogger.info('processing review job');
    const timer = jobDurationHistogram.startTimer({ repo });

    let gh: Octokit;
    let checkRunId: number | undefined;
    let previousRuns: any[] = [];

    try {
      gh = await getInstallationClient(installationId);

      const { data: commitChecks } = await gh.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
        owner,
        repo: name,
        ref: sha,
      });
      previousRuns = commitChecks.check_runs?.filter(
        (run: any) => run.name === (process.env.CHECK_NAME || 'FlowLint') && run.head_sha === sha,
      ) ?? [];

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
        throw new TypeError('Octokit client is missing paginate(); ensure @octokit/plugin-paginate-rest is registered.');
      }

      const allFiles = await paginate.call(gh, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
        owner,
        repo: name,
        pull_number: prNumber,
        per_page: 100,
      });

      const cfg = await loadConfigFromGitHub(gh, repo, sha);
      const targets = pickTargets(allFiles, cfg.files);
      const activeCheckRunId = assertCheckRunId(checkRunId);

      jobLogger.info({ totalFiles: allFiles.length, targetCount: targets.length, targetFiles: targets.map((f: any) => f.filename) }, 'files analyzed');

      if (targets.length === 0) {
        await handleNoTargets(gh, owner, name, activeCheckRunId, previousRuns, jobLogger);
        timer();
        jobsCompletedCounter.labels('success', repo).inc();
        return;
      }

      const findings = await processTargets(gh, repo, targets, cfg, jobLogger);
      await completeCheckRun(gh, owner, name, activeCheckRunId, findings, cfg, jobLogger);
      await supersedePreviousRuns(gh, owner, name, activeCheckRunId, previousRuns, jobLogger);

      timer();
      jobsCompletedCounter.labels('success', repo).inc();
    } catch (error) {
      jobLogger.error({ error }, 'job failed');
      timer();
      jobsCompletedCounter.labels('failure', repo).inc();

      if (gh! && checkRunId) {
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
  };
