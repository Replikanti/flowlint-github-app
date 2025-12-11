/**
 * GitHub API tracing wrapper
 * Instruments GitHub API calls with OpenTelemetry spans
 */

import { withClientSpan, SpanNames } from './index';
import type { Span } from '@opentelemetry/api';

/**
 * Wrap a GitHub API call with tracing
 */
export async function traceGitHubApiCall<T>(
  method: string,
  endpoint: string,
  fn: () => Promise<T>,
  additionalAttributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return withClientSpan(
    SpanNames.GITHUB_API_CALL,
    async (span: Span) => {
      span.setAttributes({
        'github.api.method': method,
        'github.api.endpoint': endpoint,
        'http.method': method,
        'http.url': endpoint,
        ...additionalAttributes,
      });

      const startTime = Date.now();
      
      try {
        const result = await fn();
        const duration = Date.now() - startTime;
        
        span.setAttributes({
          'github.api.duration_ms': duration,
          'http.status_code': 200, // Assuming success
        });

        span.addEvent('github.api.call.success', {
          duration_ms: duration,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        span.setAttributes({
          'github.api.duration_ms': duration,
          'github.api.error': true,
          'error.type': error instanceof Error ? error.constructor.name : 'UnknownError',
        });

        if (error instanceof Error) {
          span.recordException(error);
        }

        throw error;
      }
    },
  );
}

/**
 * GitHub API call attributes for common operations
 */
export const GitHubApiAttributes = {
  listFiles: (owner: string, repo: string, prNumber: number) => ({
    'github.repo.owner': owner,
    'github.repo.name': repo,
    'github.pr.number': prNumber,
    'github.api.operation': 'list_pr_files',
  }),
  
  getContent: (owner: string, repo: string, path: string, ref: string) => ({
    'github.repo.owner': owner,
    'github.repo.name': repo,
    'github.file.path': path,
    'github.ref': ref,
    'github.api.operation': 'get_content',
  }),
  
  createCheckRun: (owner: string, repo: string, sha: string) => ({
    'github.repo.owner': owner,
    'github.repo.name': repo,
    'github.commit.sha': sha,
    'github.api.operation': 'create_check_run',
  }),
  
  updateCheckRun: (owner: string, repo: string, checkRunId: number) => ({
    'github.repo.owner': owner,
    'github.repo.name': repo,
    'github.check_run.id': checkRunId,
    'github.api.operation': 'update_check_run',
  }),
};
