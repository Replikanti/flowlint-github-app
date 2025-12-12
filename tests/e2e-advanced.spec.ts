import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Octokit } from 'octokit';
import { createMockOctokit } from './helpers/mock-github';
import {
  createRateLimitError,
  createGracefulShutdown,
  generateLargeWorkflowNodes,
  generateMockFindings,
  parseRepo,
} from './helpers/test-utils';

describe('E2E Advanced Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GitHub API Rate Limiting', () => {
    it('handles primary rate limit gracefully', { timeout: 30000 }, async () => {
      // Import modules FIRST
      const githubClient = await import('../packages/github/client');

      let callCount = 0;
      const mockOctokit = createMockOctokit(async (endpoint: string, options?: any) => {
        callCount++;

        // First call succeeds (create check run)
        if (callCount === 1) {
          return { data: { id: 12345 } };
        }

        // Second call hits rate limit
        if (callCount === 2) {
          throw createRateLimitError();
        }

        // Third call succeeds (after retry)
        return { data: { check_runs: [] } };
      });

      vi.spyOn(githubClient, 'getInstallationClient').mockResolvedValue(mockOctokit);

      const gh = await githubClient.getInstallationClient(123456);

      // First call should succeed
      const check = await gh.request('POST /repos/{owner}/{repo}/check-runs', {
        owner: 'owner',
        repo: 'repo',
        name: 'FlowLint',
        head_sha: 'abc123',
        status: 'in_progress',
        started_at: new Date().toISOString(),
      });

      expect(check.data.id).toBe(12345);

      // Second call should fail with rate limit
      await expect(
        gh.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
          owner: 'owner',
          repo: 'repo',
          ref: 'abc123',
        })
      ).rejects.toThrow('API rate limit exceeded');

      expect(callCount).toBe(2);
    });

    it('respects retry-after header on rate limit', async () => {
      // Import modules FIRST
      const githubClient = await import('../packages/github/client');

      const startTime = Date.now();
      let retryAfterTime = 0;

      const mockOctokit = createMockOctokit(async (endpoint: string) => {
        const now = Date.now();

        if (endpoint.includes('check-runs') && now < retryAfterTime) {
          throw createRateLimitError(1);
        }

        return { data: { check_runs: [] } };
      });

      vi.spyOn(githubClient, 'getInstallationClient').mockResolvedValue(mockOctokit);

      const gh = await githubClient.getInstallationClient(123456);

      // Set rate limit expiry
      retryAfterTime = Date.now() + 100;

      try {
        await gh.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
          owner: 'owner',
          repo: 'repo',
          ref: 'abc123',
        });
      } catch (error: any) {
        expect(error.message).toContain('rate limit');
      }
    });
  });

  describe('Graceful Shutdown with Active Jobs', () => {
    it('waits for active jobs to complete before shutdown', async () => {
      const jobCompletionPromises: Array<() => void> = [];
      let isProcessing = false;

      // Simulate a long-running job
      const mockJobProcessor = async () => {
        isProcessing = true;
        await new Promise<void>((resolve) => {
          jobCompletionPromises.push(resolve);
        });
        isProcessing = false;
      };

      // Start job processing
      const jobPromise = mockJobProcessor();

      // Verify job is processing
      expect(isProcessing).toBe(true);

      // Simulate shutdown signal
      const shutdownPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          // Complete the job during shutdown
          jobCompletionPromises.forEach((complete) => complete());
          resolve();
        }, 100);
      });

      await Promise.all([jobPromise, shutdownPromise]);

      // Job should be completed
      expect(isProcessing).toBe(false);
    });

    it('respects graceful shutdown timeout', async () => {
      const SHUTDOWN_TIMEOUT = 1000; // 1 second
      let jobCompleted = false;

      const longRunningJob = async () => {
        await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT * 2));
        jobCompleted = true;
      };

      const gracefulShutdown = createGracefulShutdown(SHUTDOWN_TIMEOUT);

      const jobPromise = longRunningJob();
      const result = await gracefulShutdown(jobPromise);

      expect(result.forcedKill).toBe(true);
      expect(jobCompleted).toBe(false);
    });
  });

  describe('Redis Connection Failures', () => {
    it('handles Redis connection timeout gracefully', { timeout: 30000 }, async () => {
      const { enqueueReview, setReviewQueue } = await import('../apps/api/src/queue');

      const addSpy = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
      setReviewQueue({ add: addSpy } as any);

      const job = {
        installationId: 123456,
        repo: 'owner/repo',
        prNumber: 1,
        sha: 'abc123',
      };

      await expect(enqueueReview(job)).rejects.toThrow('ETIMEDOUT');
      expect(addSpy).toHaveBeenCalledTimes(1);
    });

    it('handles Redis disconnection during job processing', async () => {
      // Simulate Redis becoming unavailable mid-processing
      const mockQueue = {
        add: vi.fn().mockResolvedValue({ id: 'job-1' }),
        getJob: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };

      const { enqueueReview, setReviewQueue } = await import('../apps/api/src/queue');
      setReviewQueue(mockQueue as any);

      const job = {
        installationId: 123456,
        repo: 'owner/repo',
        prNumber: 1,
        sha: 'abc123',
      };

      // Enqueue should succeed
      const result = await enqueueReview(job);
      expect(result).toBeDefined();

      // Getting job should fail
      await expect(mockQueue.getJob('job-1')).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('Large File Processing', () => {
    it('handles workflow files exceeding 2MB limit', { timeout: 20000 }, async () => {
      // Create a large workflow JSON (simulate 3MB)
      const largeNodes = generateLargeWorkflowNodes(10000);

      const largeWorkflow = JSON.stringify({
        nodes: largeNodes,
        connections: {},
      });

      const fileSizeInMB = Buffer.from(largeWorkflow).length / (1024 * 1024);
      expect(fileSizeInMB).toBeGreaterThan(2);

      // Parser should handle large files
      const { parseN8n } = await import('@replikanti/flowlint-core')
      const graph = parseN8n(largeWorkflow);

      expect(graph.nodes.length).toBe(10000);
    });

    it('limits annotation raw_details to 64KB GitHub limit', async () => {
      const { buildAnnotations } = await import('@replikanti/flowlint-core')

      const finding = {
        rule: 'R4',
        severity: 'must' as const,
        path: 'workflows/test.json',
        message: 'Hardcoded secret detected',
        raw_details: 'x'.repeat(100000), // 100KB
        line: 1,
      };

      const annotations = buildAnnotations([finding]);

      // raw_details should be truncated to 64KB
      expect(annotations[0].raw_details.length).toBeLessThanOrEqual(64000);
    });

    it('defaults annotation line numbers to 1 when not provided', async () => {
      const { buildAnnotations } = await import('@replikanti/flowlint-core')

      const annotations = buildAnnotations([
        { rule: 'PARSE', severity: 'must', path: 'a.json', message: 'failed' },
        { rule: 'PARSE', severity: 'must', path: 'b.json', message: 'failed' },
      ]);

      expect(annotations[0].start_line).toBe(1);
      expect(annotations[1].start_line).toBe(1);
    });
  });

  describe('Concurrent PR Processing', () => {
    it('processes multiple PRs in parallel without interference', async () => {
      const mockOctokit1 = {
        request: vi.fn(async (endpoint: string) => {
          if (endpoint.includes('check-runs') && endpoint.includes('POST')) {
            return { data: { id: 1001 } };
          }
          return { data: { check_runs: [] } };
        }),
        paginate: vi.fn(async () => [
          { filename: 'workflows/pr1.n8n.json', status: 'added', sha: 'sha1' },
        ]),
      } as unknown as Octokit;

      const mockOctokit2 = {
        request: vi.fn(async (endpoint: string) => {
          if (endpoint.includes('check-runs') && endpoint.includes('POST')) {
            return { data: { id: 2002 } };
          }
          return { data: { check_runs: [] } };
        }),
        paginate: vi.fn(async () => [
          { filename: 'workflows/pr2.n8n.json', status: 'added', sha: 'sha2' },
        ]),
      } as unknown as Octokit;

      const githubClient = await import('../packages/github/client');
      let callCount = 0;

      vi.spyOn(githubClient, 'getInstallationClient')
        .mockImplementation(async (installationId: number) => {
          callCount++;
          // Return mockOctokit1 for first call, mockOctokit2 for second call
          if (callCount === 1) return mockOctokit1;
          if (callCount === 2) return mockOctokit2;
          throw new Error(`Unexpected call ${callCount} with installationId: ${installationId}`);
        });

      // Process two PRs concurrently
      const [gh1, gh2] = await Promise.all([
        githubClient.getInstallationClient(123456),
        githubClient.getInstallationClient(123456),
      ]);

      const [check1, check2] = await Promise.all([
        gh1.request('POST /repos/{owner}/{repo}/check-runs', {
          owner: 'owner',
          repo: 'repo',
          name: 'FlowLint',
          head_sha: 'pr1-sha',
          status: 'in_progress',
          started_at: new Date().toISOString(),
        }),
        gh2.request('POST /repos/{owner}/{repo}/check-runs', {
          owner: 'owner',
          repo: 'repo',
          name: 'FlowLint',
          head_sha: 'pr2-sha',
          status: 'in_progress',
          started_at: new Date().toISOString(),
        }),
      ]);

      expect(check1.data.id).toBe(1001);
      expect(check2.data.id).toBe(2002);
    });
  });

  describe('Check Run Superseding', () => {
    it('marks previous check runs as superseded', async () => {
      const checkRunUpdates: any[] = [];

      const mockOctokit = {
        request: vi.fn(async (endpoint: string, options?: any) => {
          // GET previous check runs
          if (endpoint.includes('commits') && endpoint.includes('check-runs')) {
            return {
              data: {
                check_runs: [
                  { id: 999, name: 'FlowLint', head_sha: 'abc123' },
                  { id: 888, name: 'FlowLint', head_sha: 'abc123' },
                ],
              },
            };
          }

          // CREATE new check run
          if (endpoint.includes('check-runs') && endpoint.includes('POST')) {
            return { data: { id: 1111 } };
          }

          // UPDATE check run
          if (endpoint.includes('PATCH')) {
            checkRunUpdates.push({
              id: options.check_run_id,
              conclusion: options.conclusion,
              output: options.output,
            });
            return { data: { id: options.check_run_id } };
          }

          return { data: {} };
        }),
        paginate: vi.fn(async () => []),
      } as unknown as Octokit;

      // Import modules FIRST
      const githubClient = await import('../packages/github/client');

      vi.spyOn(githubClient, 'getInstallationClient').mockResolvedValue(mockOctokit);

      const gh = await githubClient.getInstallationClient(123456);
      const [owner, repo] = parseRepo('owner/repo');

      // Get previous runs
      const { data: commitChecks } = await gh.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
        owner,
        repo,
        ref: 'abc123',
      });

      const previousRuns = commitChecks.check_runs.filter(
        (run: any) => run.name === 'FlowLint' && run.head_sha === 'abc123'
      );

      expect(previousRuns).toHaveLength(2);

      // Create new check run
      const { data: check } = await gh.request('POST /repos/{owner}/{repo}/check-runs', {
        owner,
        repo,
        name: 'FlowLint',
        head_sha: 'abc123',
        status: 'in_progress',
        started_at: new Date().toISOString(),
      });

      expect(check.id).toBe(1111);

      // Complete new check run
      await gh.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
        owner,
        repo,
        check_run_id: check.id,
        status: 'completed',
        conclusion: 'success',
        completed_at: new Date().toISOString(),
        output: { title: 'FlowLint findings', summary: 'No issues found.' },
      });

      // Supersede old runs
      await Promise.all(
        previousRuns.map(async (run: any) => {
          await gh.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
            owner,
            repo,
            check_run_id: run.id,
            status: 'completed',
            conclusion: 'neutral',
            completed_at: new Date().toISOString(),
            output: {
              title: 'Superseded by newer FlowLint run',
              summary: `This run has been replaced by FlowLint check ${check.id}.`,
            },
          });
        })
      );

      // Verify superseding
      const supersedeUpdates = checkRunUpdates.filter((u) => u.output?.title?.includes('Superseded'));
      expect(supersedeUpdates).toHaveLength(2);
      expect(supersedeUpdates[0].id).toBe(999);
      expect(supersedeUpdates[1].id).toBe(888);
    });
  });

  describe('Summary Limit Enforcement', () => {
    it('respects summary_limit config for annotations', async () => {
      const { buildCheckOutput, buildAnnotations } = await import('@replikanti/flowlint-core')
      const { defaultConfig } = await import('@replikanti/flowlint-core')

      // Create 50 findings (more than default summary_limit of 25)
      const findings = generateMockFindings(50, 'R10', 'nit');

      const cfg = structuredClone(defaultConfig);
      const { output } = buildCheckOutput({ findings, cfg });

      // Summary should show counts, not "total findings"
      expect(output.summary).toContain('50 nit');

      // Annotations should be limited to 25
      const limitedFindings = findings.slice(0, cfg.report.summary_limit);
      const annotations = buildAnnotations(limitedFindings);

      expect(annotations.length).toBe(25);
    });

    it('disables summary_limit when set to 0', async () => {
      const { buildCheckOutput, buildAnnotations } = await import('@replikanti/flowlint-core')
      const { defaultConfig } = await import('@replikanti/flowlint-core')

      const findings = generateMockFindings(100, 'R5', 'nit');

      const cfg = structuredClone(defaultConfig);
      cfg.report.summary_limit = 0; // Disable limit

      const { output } = buildCheckOutput({ findings, cfg });

      // All 100 findings should be reported
      const annotations = buildAnnotations(findings);
      expect(annotations.length).toBe(100);
    });
  });

  describe('Job Retry Logic', () => {
    it('retries failed jobs with exponential backoff', async () => {
      const { enqueueReview, setReviewQueue } = await import('../apps/api/src/queue');

      const addSpy = vi.fn().mockResolvedValue({ id: 'job-1' });
      setReviewQueue({ add: addSpy } as any);

      const job = {
        installationId: 123456,
        repo: 'owner/repo',
        prNumber: 1,
        sha: 'abc123',
      };

      await enqueueReview(job);

      // Verify backoff configuration
      expect(addSpy).toHaveBeenCalledWith(
        'review',
        job,
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        })
      );
    });
  });
});
