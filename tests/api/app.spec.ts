import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';

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

const MOCK_SECRET_VALUE = process.env.TEST_SECRET || 'random-test-value-' + Date.now();

// Helper function to send signed webhook request
function sendWebhook(event: string, payload: any) {
  const signature = 'sha256=' + crypto.createHmac('sha256', MOCK_SECRET_VALUE).update(JSON.stringify(payload)).digest('hex');
  return request(app)
    .post('/webhooks/github')
    .set('x-github-event', event)
    .set('x-hub-signature-256', signature)
    .send(payload);
}

describe('API App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = MOCK_SECRET_VALUE;
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
      pull_request: { number: 1, head: { sha: 'sha', ref: 'branch' } },
    };

    const res = await sendWebhook('pull_request', payload);
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

    const res = await sendWebhook('check_suite', payload);
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
        check_suite: { id: 456, pull_requests: [{ number: 1 }] },
      },
    };

    const res = await sendWebhook('check_run', payload);
    expect(res.status).toBe(200);
  });

  it('POST /webhooks/github should reject missing installation id', async () => {
    const payload = {
      action: 'opened',
      repository: { full_name: 'owner/repo' },
      pull_request: { number: 1, head: { sha: 'sha', ref: 'branch' } },
    };

    const res = await sendWebhook('pull_request', payload);
    expect(res.status).toBe(202);
    expect(res.body.error).toContain('Missing installation id');
  });

  it('POST /webhooks/github should reject check_suite without installation id', async () => {
    const payload = {
      action: 'requested',
      repository: { full_name: 'owner/repo' },
      check_suite: { head_sha: 'sha', id: 456 },
    };

    const res = await sendWebhook('check_suite', payload);
    expect(res.status).toBe(202);
  });

  it('POST /webhooks/github should reject invalid signature', async () => {
    const res = await request(app)
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', 'sha256=invalid')
      .send({});

    expect(res.status).toBe(401);
  });

  it('GET /openapi.json should return OpenAPI spec', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toHaveProperty('openapi');
  });

  it('should handle unhandled errors with 500 response', async () => {
    const testApp = await import('../../apps/api/src/app').then(m => m.app);

    const res = await request(testApp)
      .post('/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', 'sha256=invalid')
      .send('invalid json');

    expect(res.status).toBe(500);
  });

  it('POST /webhooks/github should handle check_suite with empty pull_requests', async () => {
    const payload = {
      action: 'requested',
      installation: { id: 123 },
      repository: { full_name: 'owner/repo' },
      check_suite: { head_sha: 'sha', id: 456, pull_requests: [] },
    };

    const res = await sendWebhook('check_suite', payload);
    expect(res.status).toBe(202);
    expect(res.body.error).toContain('No pull requests attached to check suite');
  });

  it('POST /webhooks/github should handle check_suite with check_runs fallback', async () => {
    const payload = {
      action: 'requested',
      installation: { id: 123 },
      repository: { full_name: 'owner/repo' },
      check_suite: {
        head_sha: 'sha',
        id: 456,
        pull_requests: [{ number: 1, head: { ref: 'branch' } }],
        check_runs: [{ id: 1, head_sha: 'sha', name: 'FlowLint' }],
      },
    };

    const res = await sendWebhook('check_suite', payload);
    expect(res.status).toBe(200);
  });

  it('POST /webhooks/github should match check run by app.slug', async () => {
    const payload = {
      action: 'requested',
      installation: { id: 123 },
      repository: { full_name: 'owner/repo' },
      check_suite: {
        head_sha: 'sha',
        id: 456,
        pull_requests: [{ number: 1, head: { ref: 'branch' } }],
        latest_check_runs: [
          { id: 789, head_sha: 'sha', name: 'OtherCheck', app: { slug: 'flowlint' } },
        ],
      },
    };

    const res = await sendWebhook('check_suite', payload);
    expect(res.status).toBe(200);
  });

  it('POST /webhooks/github should use head_branch fallback in check_run', async () => {
    const payload = {
      action: 'rerequested',
      installation: { id: 123 },
      repository: { full_name: 'owner/repo' },
      check_run: {
        id: 789,
        head_sha: 'sha',
        head_branch: 'fallback-branch',
        check_suite: { id: 456, pull_requests: [{ number: 1 }] },
      },
    };

    const res = await sendWebhook('check_run', payload);
    expect(res.status).toBe(200);
  });

  it('GET /readyz should return health status', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
  });
});
