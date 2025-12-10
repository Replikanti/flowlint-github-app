/**
 * Express Middleware for HTTP Metrics Collection
 *
 * This middleware automatically tracks HTTP request metrics including:
 * - Request duration (latency)
 * - Request count by method, route, status
 *
 * @module packages/observability/middleware
 */

import { Request, Response, NextFunction } from 'express';
import { httpRequestDuration } from './metrics';

/**
 * Express middleware to collect HTTP request metrics
 *
 * Automatically instruments all HTTP requests with Prometheus metrics.
 * Metrics are labeled by HTTP method, route path, and response status code.
 *
 * Usage:
 *   import { metricsMiddleware } from './packages/observability/middleware';
 *   app.use(metricsMiddleware);
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Start timer for this request
  const timer = httpRequestDuration.startTimer({
    method: req.method,
    route: req.route?.path || req.path,
    status: '0' // Will be updated on response finish
  });

  // Record duration when response finishes
  res.on('finish', () => {
    try {
      timer({ status: res.statusCode.toString() });
    } catch (error) {
      // Don't let metrics errors crash the application
      console.error('Failed to record HTTP metrics:', error);
    }
  });

  next();
}

/**
 * Middleware error handler
 *
 * Ensures metrics failures don't crash the application.
 * Logs errors and continues processing.
 */
export function metricsErrorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  console.error('Metrics middleware error:', err);
  next(err); // Pass error to next error handler
}
