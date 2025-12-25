import 'dotenv/config';
import { setupApiTracing } from './tracing';
setupApiTracing().catch((error) => console.error('Failed to initialize tracing:', error));

import { app } from './app';
import { logger } from '../../../packages/logger';
import { getReviewQueue } from './queue';
import { startQueueMetricsCollector } from '../../../packages/observability';

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  logger.info({ port }, 'API server started');

  // Start queue metrics collector
  const queue = getReviewQueue();
  startQueueMetricsCollector(queue);
  logger.info('Queue metrics collector started');
});
