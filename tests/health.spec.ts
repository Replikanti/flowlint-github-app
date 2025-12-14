import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkHealth } from '../apps/api/src/health';
import { setReviewQueue } from '../apps/api/src/queue';

describe('Health Check', () => {
  beforeEach(() => {
    // Set NODE_ENV to test to avoid creating real queue
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok status when all checks pass', async () => {
    // Mock queue with healthy Redis and low job count
    const mockQueue = {
      waitUntilReady: vi.fn().mockResolvedValue(true),
      client: {
        ping: vi.fn().mockResolvedValue('PONG'),
      },
      getWaitingCount: vi.fn().mockResolvedValue(5),
      add: vi.fn(),
    };

    setReviewQueue(mockQueue as any);

    const health = await checkHealth();

    expect(health.status).toBe('ok');
    expect(health.checks.redis.status).toBe('ok');
    expect(health.checks.queue.status).toBe('ok');
    expect(health.checks.redis.latency).toBeDefined();
    expect(health.checks.queue.waiting).toBe(5);
    expect(health.version).toBeDefined();
    expect(health.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns degraded status when queue has many waiting jobs', async () => {
    const mockQueue = {
      waitUntilReady: vi.fn().mockResolvedValue(true),
      client: {
        ping: vi.fn().mockResolvedValue('PONG'),
      },
      getWaitingCount: vi.fn().mockResolvedValue(100), // More than 50
      add: vi.fn(),
    };

    setReviewQueue(mockQueue as any);

    const health = await checkHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks.redis.status).toBe('ok');
    expect(health.checks.queue.status).toBe('degraded');
    expect(health.checks.queue.waiting).toBe(100);
  });

  it('returns error status when Redis is down', async () => {
    const mockQueue = {
      waitUntilReady: vi.fn().mockResolvedValue(true),
      client: {
        ping: vi.fn().mockRejectedValue(new Error('Connection refused')),
      },
      getWaitingCount: vi.fn().mockResolvedValue(5),
      add: vi.fn(),
    };

    setReviewQueue(mockQueue as any);

    const health = await checkHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks.redis.status).toBe('error');
    expect(health.checks.redis.error).toContain('Connection refused');
    expect(health.checks.queue.status).toBe('ok');
  });

  it('returns error status when queue check fails', async () => {
    const mockQueue = {
      waitUntilReady: vi.fn().mockResolvedValue(true),
      client: {
        ping: vi.fn().mockResolvedValue('PONG'),
      },
      getWaitingCount: vi.fn().mockRejectedValue(new Error('Queue unavailable')),
      add: vi.fn(),
    };

    setReviewQueue(mockQueue as any);

    const health = await checkHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks.redis.status).toBe('ok');
    expect(health.checks.queue.status).toBe('error');
    expect(health.checks.queue.error).toContain('Queue unavailable');
  });

  it('measures Redis latency', async () => {
    const mockQueue = {
      waitUntilReady: vi.fn().mockResolvedValue(true),
      client: {
        ping: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => setTimeout(() => resolve('PONG'), 50));
        }),
      },
      getWaitingCount: vi.fn().mockResolvedValue(0),
      add: vi.fn(),
    };

    setReviewQueue(mockQueue as any);

    const health = await checkHealth();

    expect(health.checks.redis.latency).toBeGreaterThanOrEqual(45);
  });
});
