/**
 * Metric Collectors for FlowLint
 *
 * This module implements periodic metric collectors that query external systems
 * (e.g., BullMQ queue) and update gauge metrics.
 *
 * @module packages/observability/collectors
 */

import { Queue } from 'bullmq';
import { queueDepthGauge } from './metrics';
import { createChildLogger } from '../logger';

const logger = createChildLogger({ component: 'observability:collectors' });

/**
 * Queue Metrics Collector
 *
 * Periodically queries BullMQ queue for depth by state and updates Prometheus gauges.
 * Runs every 10 seconds to provide near-real-time queue visibility.
 *
 * @param queue - BullMQ queue instance
 * @returns Interval timer (for cleanup)
 *
 * @example
 *   import { Queue } from 'bullmq';
 *   import { startQueueMetricsCollector } from './packages/observability/collectors';
 *
 *   const queue = new Queue('pr-review', { connection: redis });
 *   const collectorInterval = startQueueMetricsCollector(queue);
 *
 *   // Later, to stop collector:
 *   clearInterval(collectorInterval);
 */
export function startQueueMetricsCollector(queue: Queue<any>): NodeJS.Timeout {
  logger.info('Starting queue metrics collector (10s interval)');

  const updateQueueMetrics = async () => {
    try {
      // Get job counts from BullMQ queue
      // getJobCounts() returns: { waiting, active, completed, failed, delayed, paused }
      const counts = await (queue as any).getJobCounts();

      // Update gauges for each state
      queueDepthGauge.set({ state: 'waiting' }, counts.waiting || 0);
      queueDepthGauge.set({ state: 'active' }, counts.active || 0);
      queueDepthGauge.set({ state: 'failed' }, counts.failed || 0);
      queueDepthGauge.set({ state: 'delayed' }, counts.delayed || 0);
      queueDepthGauge.set({ state: 'paused' }, counts.paused || 0);

      logger.debug({ counts }, 'Queue metrics updated');
    } catch (error) {
      // Don't crash if queue is temporarily unavailable
      logger.warn({ error }, 'Failed to update queue metrics');
    }
  };

  // Initial update (don't wait 10 seconds for first metrics)
  updateQueueMetrics();

  // Update every 10 seconds
  const interval = setInterval(updateQueueMetrics, 10000);

  return interval;
}

/**
 * Stop queue metrics collector
 *
 * Clears the interval timer to stop metric collection.
 *
 * @param interval - Interval timer from startQueueMetricsCollector
 *
 * @example
 *   stopQueueMetricsCollector(collectorInterval);
 */
export function stopQueueMetricsCollector(interval: NodeJS.Timeout): void {
  logger.info('Stopping queue metrics collector');
  clearInterval(interval);
}
