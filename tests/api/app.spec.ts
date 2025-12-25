import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock dependencies
vi.mock('../../apps/api/src/queue', () => ({
  enqueueReview: vi.fn(),
  getReviewQueue: vi.fn().mockReturnValue({}),
}));

vi.mock('../../apps/api/src/health', () => ({
  checkHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
}));

vi.mock('../../packages/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createCorrelatedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../packages/observability', () => ({
  metricsMiddleware: (req: any, res: any, next: any) => next(),
  getMetrics: vi.fn().mockResolvedValue('metrics'),
  getContentType: vi.fn().mockReturnValue('text/plain'),
  webhookCounter: { labels: vi.fn().mockReturnThis(), inc: vi.fn() },
  startQueueMetricsCollector: vi.fn(),
}));

// We need to import app AFTER mocks
import { app } from '../../apps/api/src/app';

describe('API App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = 'test-secret';
  });

  it('GET /healthz should return 200 OK', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /livez should return 200 OK', async () => {
    const res = await request(app).get('/livez');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /metrics should return metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toBe('metrics');
  });

  it('POST /webhooks/github should handle PR opened event', async () => {
    const payload = {
      action: 'opened',
      installation: { id: 123 },
      repository: { full_name: 'owner/repo' },
      pull_request: {
        number: 1,
        head: { sha: 'sha', ref: 'branch' },
      },
    };

    const signature = 'sha256=' + require('crypto').createHmac('sha256', 'test-secret').update(JSON.stringify(payload)).digest('hex');

    const res = await request(app)
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', signature)
      .send(payload);

    expect(res.status).toBe(200);
  });

  it('POST /webhooks/github should handle check_suite event', async () => {
    const payload = {
      action: 'requested',
      installation: { id: 123 },
      repository: { full_name: 'owner/repo' },
      check_suite: {
        head_sha: 'sha',
        id: 456,
        pull_requests: [{ number: 1, head: { ref: 'branch' } }],
      },
    };
    const signature = 'sha256=' + require('crypto').createHmac('sha256', 'test-secret').update(JSON.stringify(payload)).digest('hex');

    const res = await request(app)
      .post('/webhooks/github')
      .set('x-github-event', 'check_suite')
      .set('x-hub-signature-256', signature)
      .send(payload);

    expect(res.status).toBe(200);
  });

  it('POST /webhooks/github should handle check_run event', async () => {
    const payload = {
      action: 'rerequested',
      installation: { id: 123 },
      repository: { full_name: 'owner/repo' },
      check_run: {
        id: 789,
        head_sha: 'sha',
        check_suite: {
          id: 456,
          pull_requests: [{ number: 1 }],
        },
      },
    };
    const signature = 'sha256=' + require('crypto').createHmac('sha256', 'test-secret').update(JSON.stringify(payload)).digest('hex');

    const res = await request(app)
      .post('/webhooks/github')
      .set('x-github-event', 'check_run')
      .set('x-hub-signature-256', signature)
      .send(payload);

    expect(res.status).toBe(200);
  });

  it('POST /webhooks/github should reject invalid signature', async () => {
    const res = await request(app)
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', 'sha256=invalid')
      .send({});

    expect(res.status).toBe(401);
  });
});
