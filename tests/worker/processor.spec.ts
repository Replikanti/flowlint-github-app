import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reviewProcessor } from '../../apps/worker/src/review-processor';
import type { Job } from 'bullmq';

// Mock dependencies
vi.mock('../../packages/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../../packages/observability', () => ({
  jobsCompletedCounter: { labels: vi.fn().mockReturnThis(), inc: vi.fn() },
  jobDurationHistogram: { startTimer: vi.fn().mockReturnValue(vi.fn()) },
  findingsGeneratedCounter: { labels: vi.fn().mockReturnThis(), inc: vi.fn() },
}));

vi.mock('../../packages/tracing/exports', () => ({
  withSpan: vi.fn((name, cb) => cb({ end: vi.fn() })),
  SpanNames: { WORKER_PROCESS: 'worker.process' },
  setSpanAttributes: vi.fn(),
  recordSpanException: vi.fn(),
}));

// Mock GitHub Client
const { mockOctokit } = vi.hoisted(() => {
  return { 
    mockOctokit: { 
      request: vi.fn(), 
      paginate: vi.fn() 
    } 
  };
});

vi.mock('../../packages/github/client', () => ({
  getInstallationClient: vi.fn().mockResolvedValue(mockOctokit),
}));

// Mock Config Loader
vi.mock('../../packages/github/config-loader', () => ({
  loadConfigFromGitHub: vi.fn(),
}));

// Mock Sniffer
vi.mock('../../packages/github/sniffer', () => ({
  pickTargets: vi.fn(),
  fetchRawFiles: vi.fn(),
}));

// Mock Core
const { mockRunAllRules, mockBuildCheckOutput, mockBuildAnnotations, mockParseN8n } = vi.hoisted(() => ({
  mockRunAllRules: vi.fn(),
  mockBuildCheckOutput: vi.fn(),
  mockBuildAnnotations: vi.fn(),
  mockParseN8n: vi.fn(),
}));

vi.mock('@replikanti/flowlint-core', () => ({
  parseN8n: mockParseN8n,
  runAllRules: mockRunAllRules,
  buildCheckOutput: mockBuildCheckOutput,
  buildAnnotations: mockBuildAnnotations,
  getExampleLink: vi.fn(),
  ValidationError: class ValidationError extends Error { errors = []; },
}));

import { getInstallationClient } from '../../packages/github/client';
import { loadConfigFromGitHub } from '../../packages/github/config-loader';
import { pickTargets, fetchRawFiles } from '../../packages/github/sniffer';

describe('Worker Processor', () => {
  const mockJob = {
    id: 'job-123',
    data: {
      installationId: 123,
      repo: 'owner/repo',
      prNumber: 1,
      sha: 'sha123',
      checkSuiteId: 456,
    },
  } as unknown as Job;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHECK_NAME = 'FlowLint';
    
    // Default mock responses
    mockOctokit.request.mockResolvedValue({ data: {} }); // generic
    mockOctokit.paginate.mockResolvedValue([]); // Default empty file list
    
    // Check runs setup
    mockOctokit.request.mockImplementation((route) => {
      if (route.includes('POST /repos/{owner}/{repo}/check-runs')) {
        return { data: { id: 789 } }; // New check run ID
      }
      if (route.includes('GET /repos/{owner}/{repo}/commits/{ref}/check-runs')) {
        return { data: { check_runs: [] } };
      }
      return { data: {} };
    });

    (getInstallationClient as any).mockResolvedValue(mockOctokit);
    (loadConfigFromGitHub as any).mockResolvedValue({ 
      files: { include: [] }, 
      report: { summary_limit: 10, annotations: true } 
    });
    (pickTargets as any).mockReturnValue([]);
    (fetchRawFiles as any).mockResolvedValue({ contents: new Map(), errors: [] });
    mockBuildCheckOutput.mockReturnValue({ conclusion: 'neutral', output: { title: '', summary: '' } });
  });

  it('should process a job with no target files successfully', async () => {
    await reviewProcessor(mockJob);

    expect(getInstallationClient).toHaveBeenCalledWith(123);
    // Should create check run
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/check-runs',
      expect.objectContaining({ status: 'in_progress' })
    );
    // Should list files
    expect(mockOctokit.paginate).toHaveBeenCalled();
    // Should complete check run as neutral
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}',
      expect.objectContaining({ 
        check_run_id: 789,
        conclusion: 'neutral',
        status: 'completed'
      })
    );
  });

  it('should process a job with target files and findings', async () => {
    (pickTargets as any).mockImplementation(() => {
        return [{ filename: 'workflow.json' }];
    });
    (fetchRawFiles as any).mockResolvedValue({ 
      contents: new Map([['workflow.json', '{ "nodes": [], "connections": {} }']]), 
      errors: [] 
    });
    mockParseN8n.mockReturnValue({ nodes: [], edges: [], meta: { nodeLines: {} } });
    mockRunAllRules.mockReturnValue([{ rule: 'R1', severity: 'must', message: 'Error' }]);
    mockBuildCheckOutput.mockReturnValue({ 
      conclusion: 'failure', 
      output: { title: 'Failed', summary: 'Found errors' } 
    });
    mockBuildAnnotations.mockReturnValue([]);

    await reviewProcessor(mockJob);

    // Should fetch files
    expect(fetchRawFiles).toHaveBeenCalled();
    // Should run rules
    expect(mockRunAllRules).toHaveBeenCalled();
    // Should complete with failure
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}',
      expect.objectContaining({ 
        check_run_id: 789,
        conclusion: 'failure' 
      })
    );
  });

  it('should handle errors gracefully by marking check run as failure', async () => {
    const error = new Error('GitHub API Error');
    mockOctokit.paginate.mockRejectedValue(error);

    await expect(reviewProcessor(mockJob)).rejects.toThrow('GitHub API Error');

    // Should verify it tried to update check run to failure
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}',
      expect.objectContaining({ 
        check_run_id: 789,
        conclusion: 'failure',
        output: expect.objectContaining({ title: 'FlowLint analysis failed' })
      })
    );
  });
});
