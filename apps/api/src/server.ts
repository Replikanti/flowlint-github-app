import 'dotenv/config';
// Initialize tracing BEFORE any other imports that need instrumentation
import { setupApiTracing } from './tracing';
setupApiTracing().catch((error) => console.error('Failed to initialize tracing:', error));

import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import type { Request, Response, NextFunction } from 'express';
import { enqueueReview, getReviewQueue } from './queue';
import { logger, createCorrelatedLogger } from 'packages/logger';
import { checkHealth } from './health';
import {
  metricsMiddleware,
  getMetrics,
  getContentType,
  webhookCounter,
  startQueueMetricsCollector,
} from 'packages/observability';
import {
  withServerSpan,
  withSpan,
  SpanNames,
  propagation,
  context,
  recordSpanException,
} from 'packages/tracing';
import openapiSpec from './openapi.json';

const app = express();

// Configure trust proxy - required when behind reverse proxy (Nginx, Traefik, etc.)
// This allows Express to correctly identify client IPs from X-Forwarded-For headers
// and enables rate limiting to work properly
const trustProxy = process.env.TRUST_PROXY || 'false';
if (trustProxy === 'true') {
  app.set('trust proxy', true);
} else if (trustProxy === 'false') {
  app.set('trust proxy', false);
} else if (!isNaN(Number(trustProxy))) {
  // Trust N number of proxy hops (e.g., "1" for single proxy)
  app.set('trust proxy', Number(trustProxy));
} else {
  // Trust specific IP addresses or ranges (e.g., "127.0.0.1, 10.0.0.0/8")
  app.set('trust proxy', trustProxy);
}

// Add Prometheus metrics middleware early in the stack
app.use(metricsMiddleware);

const rawBodySymbol = Symbol('rawBody');

type RawBodyRequest = Request & { [rawBodySymbol]?: Buffer };

app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    (req as RawBodyRequest)[rawBodySymbol] = Buffer.from(buf);
  },
}));

// Rate limiter for webhook endpoint to prevent DoS attacks
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 100, // max 100 requests per window per IP
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  handler: (req, res) => {
    logger.warn({
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
    }, 'rate limit exceeded');
    res.status(429).json({
      ok: false,
      error: 'Too many requests, please try again later.',
    });
  },
});

app.post('/webhooks/github', webhookLimiter, async (req: Request, res: Response) => {
  const delivery = req.headers['x-github-delivery'] as string;
  const event = req.headers['x-github-event'] as string;
  const payload = req.body as any;

  // Create correlated logger for tracking this webhook through the pipeline
  const webhookLogger = createCorrelatedLogger(delivery || 'unknown', {
    event,
    action: payload.action,
  });

  try {
    verifySignature(req as RawBodyRequest);
  } catch (error) {
    webhookLogger.warn({ error: (error as Error).message }, 'webhook signature verification failed');
    return res.status(401).json({ ok: false, error: (error as Error).message });
  }

  webhookLogger.info('webhook received');

  // Increment webhook counter metric
  webhookCounter.labels(event, payload.action || 'unknown').inc();

  if (event === 'pull_request' && ['opened', 'synchronize', 'ready_for_review'].includes(payload.action)) {
    if (!payload.installation?.id) {
      return res.status(202).json({ ok: false, error: 'Missing installation id' });
    }
    await enqueueReview({
      installationId: payload.installation.id,
      repo: payload.repository.full_name,
      prNumber: payload.pull_request.number,
      sha: payload.pull_request.head.sha,
      headBranch: payload.pull_request.head.ref,
    });
    return res.status(200).json({ ok: true, delivery });
  }

  if (event === 'check_suite' && ['requested', 'rerequested'].includes(payload.action)) {
    if (!payload.installation?.id) {
      return res.status(202).json({ ok: false, error: 'Missing installation id' });
    }
    const suite = payload.check_suite;
    const prs = suite?.pull_requests ?? [];
    if (!suite?.head_sha || prs.length === 0) {
      return res.status(202).json({ ok: false, error: 'No pull requests attached to check suite' });
    }
    const latestRuns = suite.latest_check_runs ?? suite.check_runs ?? [];

    await Promise.all(
      prs.map((pr: any) => {
        const matchingRun = latestRuns.find(
          (run: any) =>
            run.head_sha === suite.head_sha &&
            (run.name === (process.env.CHECK_NAME || 'FlowLint') || run.app?.slug === 'flowlint'),
        );

        return enqueueReview({
          installationId: payload.installation.id,
          repo: payload.repository.full_name,
          prNumber: pr.number,
          sha: suite.head_sha,
          headBranch: pr.head?.ref,
          checkRunId: matchingRun?.id,
          checkSuiteId: suite.id,
        });
      }),
    );
    return res.status(200).json({ ok: true, delivery });
  }

  if (event === 'check_run' && ['rerequested', 'requested_action'].includes(payload.action)) {
    if (!payload.installation?.id) {
      return res.status(202).json({ ok: false, error: 'Missing installation id' });
    }

    const run = payload.check_run;
    const pr = run?.check_suite?.pull_requests?.[0];
    if (!run?.head_sha || !pr) {
      return res.status(202).json({ ok: false, error: 'Missing pull request info for check run' });
    }

    await enqueueReview({
      installationId: payload.installation.id,
      repo: payload.repository.full_name,
      prNumber: pr.number,
      sha: run.head_sha,
      headBranch: pr.head?.ref ?? run.head_branch,
      checkRunId: run.id,
      checkSuiteId: run.check_suite?.id,
    });

    return res.status(200).json({ ok: true, delivery });
  }

  if (event === 'installation_repositories') {
    // Placeholder for syncing installation repos/job warmups.
  }

  return res.status(200).json({ ok: true, delivery });
});

// Health check endpoints for monitoring and orchestration

/**
 * Comprehensive health check - verifies all dependencies (Redis, Queue)
 * Returns 200 if healthy, 503 if any dependency is degraded/error
 */
app.get('/healthz', async (_req, res) => {
  const health = await checkHealth();
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * Liveness probe - checks if the process is alive and responsive
 * Always returns 200 unless the process is completely hung
 */
app.get('/livez', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

/**
 * Readiness probe - checks if the service can handle traffic
 * Returns 200 if ready, 503 if dependencies are unavailable
 */
app.get('/readyz', async (_req, res) => {
  const health = await checkHealth();
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * Prometheus metrics endpoint
 * Returns metrics in Prometheus exposition format
 */
app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', getContentType());
  const metrics = await getMetrics();
  res.send(metrics);
});

/**
 * OpenAPI/Swagger documentation endpoints
 * Provides interactive API documentation using Swagger UI
 */
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(openapiSpec, {
  customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css',
  customSiteTitle: 'FlowLint API Documentation',
}));

/**
 * OpenAPI spec as JSON endpoint
 * Returns the OpenAPI specification for programmatic access
 */
app.get('/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openapiSpec);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled error in request');
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  logger.info({ port }, 'API server started');

  // Start queue metrics collector
  const queue = getReviewQueue();
  startQueueMetricsCollector(queue);
  logger.info('Queue metrics collector started');
});

function verifySignature(req: RawBodyRequest) {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const secret = (process.env.WEBHOOK_SECRET || '').trim();
  if (!signature || !secret || !req[rawBodySymbol]) {
    throw new Error('Missing signature');
  }
  const digest = crypto.createHmac('sha256', secret).update(req[rawBodySymbol] as Buffer).digest('hex');
  const expected = `sha256=${digest}`;
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    logSignatureMismatch(signature, expected, req[rawBodySymbol] as Buffer);
    throw new Error('Invalid signature');
  }
}

function logSignatureMismatch(received: string, expected: string, rawBody: Buffer) {
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  logger.warn({
    received,
    expected,
    bodyHash,
  }, 'webhook signature mismatch');
}
