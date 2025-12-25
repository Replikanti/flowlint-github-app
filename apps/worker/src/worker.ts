import 'dotenv/config';
// Initialize tracing BEFORE any other imports that need instrumentation
import { setupWorkerTracing } from './tracing';
setupWorkerTracing().catch((error) => console.error('Failed to initialize tracing:', error));

import { Worker } from 'bullmq';
import { reviewProcessor } from './review-processor';
import type { ReviewJob } from '../../api/src/queue';
import { logger } from '../../../packages/logger';

const connection = {
  connection: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
};

const worker = new Worker<ReviewJob>(
  'review',
  reviewProcessor,
  connection,
);

// Graceful shutdown implementation
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.info({ signal }, 'shutdown already in progress, ignoring');
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'received shutdown signal, starting graceful shutdown');
  logger.info('waiting for active jobs to complete (max 45 seconds)');

  try {
    // Close worker gracefully - waits for active jobs to finish
    // BullMQ worker.close() accepts a boolean: false = wait for jobs, true = force close
    // TypeScript doesn't have proper types for close(), but it exists at runtime
    await worker.close();
    logger.info('all active jobs completed, shutdown successful');
  } catch (error) {
    logger.error({ error }, 'error during graceful shutdown');
    throw error;
  }
}

function shutdownAndExit(signal: string, exitCode: number) {
  gracefulShutdown(signal)
    .then(() => process.exit(exitCode))
    .catch(() => process.exit(1));
}

// Handle termination signals
process.on('SIGTERM', () => shutdownAndExit('SIGTERM', 0));
process.on('SIGINT', () => shutdownAndExit('SIGINT', 0));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error: Error) => {
  logger.error({ error }, 'uncaught exception');
  shutdownAndExit('uncaughtException', 1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, 'unhandled rejection');
  shutdownAndExit('unhandledRejection', 1);
});

// Log successful startup
logger.info({
  queue: 'review',
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
}, 'worker started successfully');
