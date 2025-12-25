import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies (same as app.spec.ts)
vi.mock('../../apps/api/src/queue', () => ({
  enqueueReview: vi.fn(),
  getReviewQueue: vi.fn().mockReturnValue({}),
}));

vi.mock('../../apps/api/src/health', () => ({
  checkHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
}));

vi.mock('../../packages/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createCorrelatedLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../../packages/observability', () => ({
  metricsMiddleware: (req: any, res: any, next: any) => next(),
  getMetrics: vi.fn().mockResolvedValue('metrics'),
  getContentType: vi.fn().mockReturnValue('text/plain'),
  webhookCounter: { labels: vi.fn().mockReturnThis(), inc: vi.fn() },
  startQueueMetricsCollector: vi.fn(),
}));

describe('App Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should set trust proxy to true', async () => {
    process.env.TRUST_PROXY = 'true';
    const { app } = await import('../../apps/api/src/app');
    expect(app.get('trust proxy')).toBe(true);
  });

  it('should set trust proxy to false', async () => {
    process.env.TRUST_PROXY = 'false';
    const { app } = await import('../../apps/api/src/app');
    expect(app.get('trust proxy')).toBe(false);
  });

  it('should set trust proxy to number', async () => {
    process.env.TRUST_PROXY = '1';
    const { app } = await import('../../apps/api/src/app');
    expect(app.get('trust proxy')).toBe(1);
  });

  it('should set trust proxy to string', async () => {
    process.env.TRUST_PROXY = 'loopback';
    const { app } = await import('../../apps/api/src/app');
    expect(app.get('trust proxy')).toBe('loopback');
  });
});
