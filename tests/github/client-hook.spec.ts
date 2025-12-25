import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the hook function
let hook: any;

vi.mock('octokit', () => {
  const MockOctokit = function(options: any) {
    hook = options.request.hook;
  };
  (MockOctokit as any).plugin = vi.fn().mockReturnValue(MockOctokit);
  return { Octokit: MockOctokit };
});

vi.mock('../../packages/observability', () => ({
  githubApiCallsCounter: {
    labels: vi.fn().mockReturnThis(),
    inc: vi.fn(),
  },
}));

vi.mock('../../packages/logger', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getInstallationClient } from '../../packages/github/client';
import { githubApiCallsCounter } from '../../packages/observability';

describe('GitHub Client Hook', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.APP_ID = '12345';
    process.env.APP_PRIVATE_KEY_PEM_BASE64 = Buffer.from('test-private-key').toString('base64');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should track success metrics', async () => {
    await getInstallationClient(123);
    
    expect(hook).toBeDefined();

    const request = vi.fn().mockResolvedValue({ status: 200 });
    const options = { method: 'GET', url: '/test' };

    await hook(request, options);

    expect(githubApiCallsCounter.labels).toHaveBeenCalledWith('GET', '200', '/test');
    expect(githubApiCallsCounter.labels('GET', '200', '/test').inc).toHaveBeenCalled();
  });

  it('should track error metrics', async () => {
    await getInstallationClient(123);
    
    const error: any = new Error('Failed');
    error.status = 500;
    const request = vi.fn().mockRejectedValue(error);
    const options = { method: 'POST', url: '/error' };

    await expect(hook(request, options)).rejects.toThrow('Failed');

    expect(githubApiCallsCounter.labels).toHaveBeenCalledWith('POST', '500', '/error');
  });
});
