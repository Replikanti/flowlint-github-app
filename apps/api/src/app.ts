import express from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import type { Request, Response, NextFunction } from 'express';
import { enqueueReview } from './queue';
import { logger, createCorrelatedLogger } from '../../../packages/logger';
import { checkHealth } from './health';
import {
  metricsMiddleware,
  getMetrics,
  getContentType,
  webhookCounter,
} from '../../../packages/observability';
import openapiSpec from './openapi.json';

const app = express();
app.disable('x-powered-by');

// Configure trust proxy
const trustProxy = process.env.TRUST_PROXY || 'false';
if (trustProxy === 'true') {
  app.set('trust proxy', true);
} else if (trustProxy === 'false') {
  app.set('trust proxy', false);
} else {
  const trustProxyNum = Number(trustProxy);
  if (Number.isFinite(trustProxyNum)) {
    app.set('trust proxy', trustProxyNum);
  } else {
    app.set('trust proxy', trustProxy);
  }
}

// Add Prometheus metrics middleware
app.use(metricsMiddleware);

export const rawBodySymbol = Symbol('rawBody');

export type RawBodyRequest = Request & { [rawBodySymbol]?: Buffer };

app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    (req as RawBodyRequest)[rawBodySymbol] = Buffer.from(buf);
  },
}));

// Rate limiter for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
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

app.post('/webhooks/github', webhookLimiter, async (req: Request, res: Response) => {
  const delivery = req.headers['x-github-delivery'] as string;
  const event = req.headers['x-github-event'] as string;
  const payload = req.body as any;

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
  webhookCounter.labels(event, payload.action || 'unknown').inc();

  if (event === 'pull_request') {
    return handlePullRequest(payload, res, delivery);
  }

  if (event === 'check_suite') {
    return handleCheckSuite(payload, res, delivery);
  }

  if (event === 'check_run') {
    return handleCheckRun(payload, res, delivery);
  }

  return res.status(200).json({ ok: true, delivery });
});

async function handlePullRequest(payload: any, res: Response, delivery: string) {
  if (!['opened', 'synchronize', 'ready_for_review'].includes(payload.action)) {
    return res.status(200).json({ ok: true, delivery });
  }
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

async function handleCheckSuite(payload: any, res: Response, delivery: string) {
  if (!['requested', 'rerequested'].includes(payload.action)) {
    return res.status(200).json({ ok: true, delivery });
  }
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

async function handleCheckRun(payload: any, res: Response, delivery: string) {
  if (!['rerequested', 'requested_action'].includes(payload.action)) {
    return res.status(200).json({ ok: true, delivery });
  }
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

app.get('/healthz', async (_req, res) => {
  const health = await checkHealth();
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/livez', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

app.get('/readyz', async (_req, res) => {
  const health = await checkHealth();
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', getContentType());
  const metrics = await getMetrics();
  res.send(metrics);
});

app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(openapiSpec, {
  customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css',
  customSiteTitle: 'FlowLint API Documentation',
}));

app.get('/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openapiSpec);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled error in request');
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

export { app };
