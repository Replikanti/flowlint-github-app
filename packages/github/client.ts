import { Octokit } from 'octokit';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { createAppAuth } from '@octokit/auth-app';
import { logger } from '../logger';
import { githubApiCallsCounter } from '../observability';

const appId = Number(process.env.APP_ID || 0);
const privateKeyBase64 = process.env.APP_PRIVATE_KEY_PEM_BASE64;
const privateKey = privateKeyBase64 ? Buffer.from(privateKeyBase64, 'base64').toString('utf8') : undefined;

if (!privateKey) {
  logger.warn('APP_PRIVATE_KEY_PEM_BASE64 is not set; GitHub auth will fail at runtime.');
}

// Octokit v4+ already includes retry and throttling plugins by default
const PaginatedOctokit = Octokit.plugin(paginateRest);

export async function getInstallationClient(installationId: number): Promise<Octokit> {
  if (!privateKey) {
    throw new Error('APP_PRIVATE_KEY_PEM_BASE64 is required to authenticate with GitHub.');
  }

  if (!appId) {
    throw new Error('APP_ID is required to authenticate with GitHub.');
  }

  const client = new PaginatedOctokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
    request: {
      timeout: 30000, // 30 second timeout for all requests
      hook: (request: any, options: any) => {
        const startTime = Date.now();
        const method = options.method?.toUpperCase() || 'UNKNOWN';
        const endpoint = options.url || 'unknown';

        return request(options)
          .then((response: any) => {
            // Track successful API calls
            const status = response.status.toString();
            githubApiCallsCounter.labels(method, status, endpoint).inc();
            logger.debug({
              method,
              endpoint,
              status,
              duration: Date.now() - startTime,
            }, 'GitHub API call succeeded');
            return response;
          })
          .catch((error: any) => {
            // Track failed API calls
            const status = error.status?.toString() || 'error';
            githubApiCallsCounter.labels(method, status, endpoint).inc();
            logger.warn({
              method,
              endpoint,
              status,
              duration: Date.now() - startTime,
              error: error.message,
            }, 'GitHub API call failed');
            throw error;
          });
      },
    },
    retry: {
      enabled: true,
      // Retry on network errors, 5xx, and rate limit errors
      retries: 3,
      doNotRetry: [400, 401, 403, 404, 422], // Don't retry client errors
    },
    throttle: {
      onRateLimit: (retryAfter: number, options: any, octokit: Octokit) => {
        logger.warn(
          {
            method: options.method,
            url: options.url,
            retryAfter,
          },
          'GitHub rate limit hit, retrying',
        );
        // Retry once after rate limit
        return retryAfter < 60;
      },
      onSecondaryRateLimit: (retryAfter: number, options: any, octokit: Octokit) => {
        logger.warn(
          {
            method: options.method,
            url: options.url,
            retryAfter,
          },
          'GitHub secondary rate limit hit',
        );
        // Don't retry on secondary rate limits (abuse detection)
        return false;
      },
    },
  });

  return client;
}
