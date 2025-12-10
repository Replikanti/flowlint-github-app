import pino from 'pino';

// Create base logger with environment-aware configuration
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

/**
 * Create a child logger with additional context.
 * Use this to add correlation IDs, request IDs, or other contextual metadata.
 */
export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Create a logger with correlation ID for tracking requests across API → Queue → Worker.
 */
export function createCorrelatedLogger(correlationId: string, additionalContext?: Record<string, unknown>) {
  return logger.child({
    correlationId,
    ...additionalContext,
  });
}
