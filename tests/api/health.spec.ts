import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../packages/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

// Mock queue
const mockGetReviewQueue = vi.fn();
vi.mock('../../apps/api/src/queue', () => ({
  getReviewQueue: mockGetReviewQueue,
}));

describe('Health Checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle null Redis client gracefully', async () => {
    const mockQueue = {
      waitUntilReady: vi.fn().mockResolvedValue(undefined),
      client: Promise.resolve(null), // Simulate null client after readiness
      getWaitingCount: vi.fn().mockResolvedValue(0),
    };
    mockGetReviewQueue.mockReturnValue(mockQueue);

    const { checkHealth } = await import('../../apps/api/src/health');
    const health = await checkHealth();

    // Should have error status for Redis
    expect(health.checks.redis.status).toBe('error');
    expect(health.checks.redis.error).toContain('Redis client not available');
    expect(health.status).toBe('degraded');
  });

  it('should return degraded status when queue has many waiting jobs', async () => {
    const mockClient = {
      ping: vi.fn().mockResolvedValue('PONG'),
    };

    const mockQueue = {
      waitUntilReady: vi.fn().mockResolvedValue(undefined),
      client: Promise.resolve(mockClient),
      getWaitingCount: vi.fn().mockResolvedValue(75), // > 50 threshold
    };
    mockGetReviewQueue.mockReturnValue(mockQueue);

    const { checkHealth } = await import('../../apps/api/src/health');
    const health = await checkHealth();

    expect(health.checks.redis.status).toBe('ok');
    expect(health.checks.queue.status).toBe('degraded');
    expect(health.checks.queue.waiting).toBe(75);
    expect(health.status).toBe('degraded');
  });

  it('should handle Redis ping failure', async () => {
    const mockClient = {
      ping: vi.fn().mockRejectedValue(new Error('Connection refused')),
    };

    const mockQueue = {
      waitUntilReady: vi.fn().mockResolvedValue(undefined),
      client: Promise.resolve(mockClient),
      getWaitingCount: vi.fn().mockResolvedValue(0),
    };
    mockGetReviewQueue.mockReturnValue(mockQueue);

    const { checkHealth } = await import('../../apps/api/src/health');
    const health = await checkHealth();

    expect(health.checks.redis.status).toBe('error');
    expect(health.checks.redis.error).toContain('Connection refused');
  });

  it('should handle queue getWaitingCount failure', async () => {
    const mockClient = {
      ping: vi.fn().mockResolvedValue('PONG'),
    };

    const mockQueue = {
      waitUntilReady: vi.fn().mockResolvedValue(undefined),
      client: Promise.resolve(mockClient),
      getWaitingCount: vi.fn().mockRejectedValue(new Error('Queue unavailable')),
    };
    mockGetReviewQueue.mockReturnValue(mockQueue);

    const { checkHealth } = await import('../../apps/api/src/health');
    const health = await checkHealth();

    expect(health.checks.queue.status).toBe('error');
    expect(health.checks.queue.error).toContain('Queue unavailable');
  });
});
