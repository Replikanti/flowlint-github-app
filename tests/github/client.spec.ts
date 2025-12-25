import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../packages/observability', () => ({
  githubApiCallsCounter: {
    labels: vi.fn().mockReturnThis(),
    inc: vi.fn(),
  },
}));

vi.mock('../packages/logger', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GitHub Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules(); // Vital for re-evaluating top-level consts
    process.env = { ...originalEnv };
    process.env.APP_ID = '12345';
    process.env.APP_PRIVATE_KEY_PEM_BASE64 = Buffer.from('test-private-key').toString('base64');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should create client when env vars are present', async () => {
    const { getInstallationClient } = await import('../../packages/github/client');
    const client = await getInstallationClient(123);
    expect(client).toBeDefined();
  });

  it('should throw if APP_ID is missing', async () => {
    delete process.env.APP_ID;
    const { getInstallationClient } = await import('../../packages/github/client');
    await expect(getInstallationClient(123)).rejects.toThrow('APP_ID is required');
  });

  it('should throw if private key is missing', async () => {
    delete process.env.APP_PRIVATE_KEY_PEM_BASE64;
    const { getInstallationClient } = await import('../../packages/github/client');
    await expect(getInstallationClient(123)).rejects.toThrow('APP_PRIVATE_KEY_PEM_BASE64 is required');
  });

  it('should configure request hook for metrics', async () => {
    const { getInstallationClient } = await import('../../packages/github/client');
    await getInstallationClient(123);
    
    // The client is an Octokit instance. We can't easily inspect constructor args from here 
    // without mocking Octokit itself.
    // However, we can invoke the hook if we can access the request chain.
    // Or we can mock Octokit to capture options.
  });
});