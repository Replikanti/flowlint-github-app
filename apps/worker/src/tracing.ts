import { initTracing, shutdownTracing } from '../../../packages/tracing/tracer';
import { traceGitHubApiCall } from '../../../packages/tracing/github-tracer';
import { SpanNames, getActiveContext, recordSpanException, setSpanAttributes, trace } from '../../../packages/tracing/exports';

// Initialize OpenTelemetry tracing for worker process
export async function setupWorkerTracing(): Promise<void> {
  if (process.env.OTEL_SDK_DISABLED === 'true') {
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'flowlint-worker';
  await initTracing({
    serviceName,
    serviceNamespace: 'flowlint',
    serviceVersion: process.env.npm_package_version || '0.3.0',
    environment: process.env.NODE_ENV || 'development',
  });
}
