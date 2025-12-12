import { getReviewQueue } from './queue';
import { logger } from 'packages/logger';

export type HealthStatus = 'ok' | 'degraded' | 'error';

export type HealthCheck = {
  status: HealthStatus;
  latency?: number;
  waiting?: number;
  error?: string;
};

export type HealthResponse = {
  status: HealthStatus;
  version: string;
  uptime: number;
  checks: {
    redis: HealthCheck;
    queue: HealthCheck;
  };
};

/**
 * Performs comprehensive health checks for all dependencies.
 * Returns detailed status for Redis connectivity and queue state.
 */
export async function checkHealth(): Promise<HealthResponse> {
  const checks = {
    redis: await checkRedis(),
    queue: await checkQueue(),
  };

  const healthy = Object.values(checks).every((c) => c.status === 'ok');

  return {
    status: healthy ? 'ok' : 'degraded',
    version: process.env.npm_package_version || '0.3.0',
    uptime: Math.floor(process.uptime()),
    checks,
  };
}

/**
 * Check Redis connectivity by pinging the server.
 * Measures latency for monitoring purposes.
 */
async function checkRedis(): Promise<HealthCheck> {
  try {
    const start = Date.now();
    const queue = getReviewQueue() as any; // BullMQ Queue has client property at runtime
    await queue.client.ping();
    const latency = Date.now() - start;

    return { status: 'ok', latency };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: errorMsg }, 'redis health check failed');
    return { status: 'error', error: errorMsg };
  }
}

/**
 * Check queue health by fetching waiting job count.
 * High waiting count may indicate worker issues.
 */
async function checkQueue(): Promise<HealthCheck> {
  try {
    const queue = getReviewQueue() as any; // BullMQ Queue has getWaitingCount at runtime
    const waiting = await queue.getWaitingCount();

    // Consider degraded if more than 50 jobs waiting
    const status: HealthStatus = waiting > 50 ? 'degraded' : 'ok';

    return { status, waiting };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: errorMsg }, 'queue health check failed');
    return { status: 'error', error: errorMsg };
  }
}
