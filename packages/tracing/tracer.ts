import { diag, DiagConsoleLogger, DiagLogLevel, Span, trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter as OTLPHttpTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as OTLPGrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { logger } from '../logger';

let sdk: NodeSDK | undefined;
let initPromise: Promise<void> | undefined;

type AutoInstrumentationOptions = Parameters<typeof getNodeAutoInstrumentations>[0];

const DEFAULT_SERVICE_VERSION = process.env.npm_package_version || '0.0.0';
const DEFAULT_ENVIRONMENT = process.env.NODE_ENV || 'development';

/**
 * Initialize OpenTelemetry tracing for FlowLint
 */
export function initTracing(options: {
  serviceName: string;
  serviceNamespace?: string;
  serviceVersion?: string;
  environment?: string;
  exporter?: 'otlp-http' | 'otlp-grpc' | 'console' | 'none';
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, string>;
  otlpTimeoutMs?: number;
  instrumentationOptions?: AutoInstrumentationOptions;
}): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const {
    serviceName,
    serviceNamespace,
    serviceVersion = DEFAULT_SERVICE_VERSION,
    environment = DEFAULT_ENVIRONMENT,
    exporter = process.env.OTEL_EXPORTER || 'otlp-http',
    otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otlpHeaders = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    otlpTimeoutMs = process.env.OTEL_EXPORTER_OTLP_TIMEOUT ? Number(process.env.OTEL_EXPORTER_OTLP_TIMEOUT) : undefined,
    instrumentationOptions = {},
  } = options;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    'service.namespace': serviceNamespace || 'flowlint',
    'deployment.environment': environment,
  });

  const instrumentations = [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => {
        const path = req.url || '';
        return ['/metrics', '/livez', '/readyz', '/healthz', '/openapi.json', '/api-docs'].some((ignorePath) =>
          path.startsWith(ignorePath),
        );
      },
    }),
    new ExpressInstrumentation(),
  ];

  const autoInstrumentations = getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
    ...instrumentationOptions,
  });

  const exporters = createExporter({ exporter, otlpEndpoint, otlpHeaders, otlpTimeoutMs });

  sdk = new NodeSDK({
    resource,
    traceExporter: exporters.traceExporter,
    instrumentations: [...instrumentations, ...Object.values(autoInstrumentations)],
  });

  initPromise = (async () => {
    await sdk!.start();
    logger.info({ serviceName }, 'OpenTelemetry tracing initialized');
  })().catch((error: Error) => {
    logger.error({ error }, 'failed to initialize OpenTelemetry tracing');
  });

  return initPromise;
}

/**
 * Shutdown OpenTelemetry
 */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
    logger.info('OpenTelemetry tracing shut down');
  } catch (error) {
    logger.error({ error }, 'failed to shut down OpenTelemetry');
  } finally {
    sdk = undefined;
    initPromise = undefined;
  }
}

/**
 * Get tracer instance
 */
export function getTracer() {
  return trace.getTracer('flowlint');
}

/**
 * Set custom span attributes (helper)
 */
export function setSpanAttributes(span: Span | undefined, attributes: Record<string, string | number | boolean>) {
  if (!span) {
    return;
  }
  span.setAttributes(attributes);
}

function parseHeaders(headersInput?: string): Record<string, string> {
  if (!headersInput) {
    return {};
  }

  try {
    const entries = headersInput.split(',').map((entry) => {
      const [key, value] = entry.split('=').map((item) => item.trim());
      return [key, value];
    });

    return Object.fromEntries(entries);
  } catch (error) {
    logger.warn({ error }, 'failed to parse OTLP headers');
    return {};
  }
}

function createExporter(options: {
  exporter: string;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, string>;
  otlpTimeoutMs?: number;
}): { traceExporter: any } {
  const { exporter, otlpEndpoint, otlpHeaders, otlpTimeoutMs } = options;

  switch (exporter) {
    case 'otlp-http':
      return {
        traceExporter: new OTLPHttpTraceExporter({
          url: otlpEndpoint,
          headers: otlpHeaders,
          timeoutMillis: otlpTimeoutMs,
        }),
      };
    case 'otlp-grpc':
      return {
        traceExporter: new OTLPGrpcTraceExporter({
          url: otlpEndpoint,
        }),
      };
    case 'console':
      return {
        traceExporter: undefined,
      };
    case 'none':
    default:
      return {
        traceExporter: undefined,
      };
  }
}
