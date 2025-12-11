/**
 * FlowLint Distributed Tracing Package
 *
 * Provides OpenTelemetry-based distributed tracing for FlowLint.
 * Tracks request flow from webhook reception through job processing to Check Run creation.
 *
 * @module packages/tracing
 */

import { Tracer, Span, SpanStatusCode, Context, context, trace, SpanKind, propagation } from '@opentelemetry/api';
import { getTracer } from './tracer';

/**
 * Trace span names following OpenTelemetry semantic conventions
 */
export const SpanNames = {
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_VERIFY_SIGNATURE: 'webhook.verify_signature',
  JOB_ENQUEUED: 'job.enqueued',
  JOB_PROCESSED: 'job.processed',
  JOB_FETCH_FILES: 'job.fetch_files',
  JOB_LOAD_CONFIG: 'job.load_config',
  JOB_PARSE_WORKFLOW: 'job.parse_workflow',
  JOB_RUN_RULES: 'job.run_rules',
  JOB_CREATE_CHECK_RUN: 'job.create_check_run',
  GITHUB_API_CALL: 'github.api_call',
  LINT_RULE_EXECUTE: 'lint.rule.execute',
  REDIS_OPERATION: 'redis.operation',
} as const;

/**
 * Get the configured tracer instance
 */
export function getTracerInstance(): Tracer {
  return getTracer();
}

/**
 * Start a new span with the given name and attributes
 */
export function startSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>,
  parentContext?: Context,
): Span {
  const tracer = getTracer();
  const ctx = parentContext || context.active();
  
  return tracer.startSpan(
    name,
    {
      kind: SpanKind.INTERNAL,
      attributes,
    },
    ctx,
  );
}

/**
 * Start a server span (for incoming requests)
 */
export function startServerSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>,
  parentContext?: Context,
): Span {
  const tracer = getTracer();
  const ctx = parentContext || context.active();

  return tracer.startSpan(
    name,
    {
      kind: SpanKind.SERVER,
      attributes,
    },
    ctx,
  );
}

/**
 * Start a client span (for outgoing requests)
 */
export function startClientSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>,
  parentContext?: Context,
): Span {
  const tracer = getTracer();
  const ctx = parentContext || context.active();
  
  return tracer.startSpan(
    name,
    {
      kind: SpanKind.CLIENT,
      attributes,
    },
    ctx,
  );
}

/**
 * Execute a function within a span context
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
  parentContext?: Context,
): Promise<T> {
  const baseContext = parentContext || context.active();
  const span = startSpan(name, attributes, parentContext);
  const ctxWithSpan = trace.setSpan(baseContext, span);

  try {
    const result = await context.with(ctxWithSpan, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof Error) {
      span.recordException(error);
    }

    throw error;
  } finally {
    span.end();
  }
}

/**
 * Execute a synchronous function within a span context
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes?: Record<string, string | number | boolean>,
  parentContext?: Context,
): T {
  const baseContext = parentContext || context.active();
  const span = startSpan(name, attributes, parentContext);
  const ctxWithSpan = trace.setSpan(baseContext, span);

  try {
    const result = context.with(ctxWithSpan, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof Error) {
      span.recordException(error);
    }

    throw error;
  } finally {
    span.end();
  }
}

/**
 * Execute a function within a server span context (for incoming requests)
 */
export async function withServerSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
  parentContext?: Context,
): Promise<T> {
  const baseContext = parentContext || context.active();
  const span = startServerSpan(name, attributes, parentContext);
  const ctxWithSpan = trace.setSpan(baseContext, span);

  try {
    const result = await context.with(ctxWithSpan, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof Error) {
      span.recordException(error);
    }

    throw error;
  } finally {
    span.end();
  }
}

/**
 * Execute a function within a client span context (for outgoing requests)
 */
export async function withClientSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
  parentContext?: Context,
): Promise<T> {
  const baseContext = parentContext || context.active();
  const span = startClientSpan(name, attributes, parentContext);
  const ctxWithSpan = trace.setSpan(baseContext, span);

  try {
    const result = await context.with(ctxWithSpan, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof Error) {
      span.recordException(error);
    }

    throw error;
  } finally {
    span.end();
  }
}

/**
 * Add an event to the current active span
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Set attributes on the current active span
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Record an exception on the current active span
 */
export function recordSpanException(error: Error): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }
}

/**
 * Get the current active span
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Get the current trace context
 */
export function getActiveContext(): Context {
  return context.active();
}

// Re-export OpenTelemetry primitives for convenience
export { Span, SpanStatusCode, Context, trace, context, propagation };
export { initTracing, shutdownTracing } from './tracer';
export { traceGitHubApiCall, GitHubApiAttributes } from './github-tracer';
