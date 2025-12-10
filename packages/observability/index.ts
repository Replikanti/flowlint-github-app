/**
 * FlowLint Observability Package
 *
 * Provides Prometheus metrics collection and exposure for FlowLint.
 *
 * @module packages/observability
 */

// Export all metrics
export {
  register,
  webhookCounter,
  jobsQueuedCounter,
  jobsCompletedCounter,
  jobDurationHistogram,
  queueDepthGauge,
  githubApiCallsCounter,
  findingsGeneratedCounter,
  redisOpsCounter,
  httpRequestDuration,
  getMetrics,
  getContentType,
  clearMetrics,
  getMetric
} from './metrics';

// Export middleware
export { metricsMiddleware, metricsErrorHandler } from './middleware';

// Export collectors
export { startQueueMetricsCollector, stopQueueMetricsCollector } from './collectors';
