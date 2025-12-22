import { initTracing } from '../../../packages/tracing/tracer';

// Initialize OpenTelemetry tracing for API server
// This must be called BEFORE any other imports that need instrumentation
export async function setupApiTracing(): Promise<void> {
  const serviceName = process.env.OTEL_SERVICE_NAME || 'flowlint-api';
  
  // Only initialize if tracing is not explicitly disabled
  if (process.env.OTEL_SDK_DISABLED === 'true') {
    return;
  }

  await initTracing({
    serviceName,
    serviceNamespace: 'flowlint',
    serviceVersion: process.env.npm_package_version || '0.3.0',
    environment: process.env.NODE_ENV || 'development',
  });
}
