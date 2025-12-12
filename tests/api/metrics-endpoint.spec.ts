import { describe, it, expect, beforeAll } from 'vitest';
import {
  register,
  webhookCounter,
  jobsQueuedCounter,
  jobsCompletedCounter,
  jobDurationHistogram,
  queueDepthGauge,
  githubApiCallsCounter,
  findingsGeneratedCounter,
  getMetrics,
  getContentType,
} from '../../packages/observability/metrics';

/**
 * Integration tests for /metrics endpoint
 *
 * Tests the Prometheus metrics endpoint functionality:
 * - Metric format validation
 * - Metric collection and reporting
 * - Performance characteristics
 */

describe('GET /metrics - Integration Tests', () => {
  beforeAll(async () => {
    // Reset metrics before tests
    register.resetMetrics();
  });

  it('should return valid Prometheus text format', async () => {
    const contentType = getContentType();
    expect(contentType).toContain('text/plain');
    expect(contentType).toContain('version=0.0.4');
  });

  it('should return metrics in Prometheus exposition format', async () => {
    // Increment some counters to generate metrics
    webhookCounter.labels('pull_request', 'opened').inc();
    jobsQueuedCounter.labels('test/repo').inc();

    const metrics = await getMetrics();

    // Verify it's a string (not empty)
    expect(typeof metrics).toBe('string');
    expect(metrics.length).toBeGreaterThan(0);

    // Verify Prometheus format markers
    expect(metrics).toContain('# HELP');
    expect(metrics).toContain('# TYPE');
  });

  it('should include all custom metrics', async () => {
    // Reset and populate metrics
    register.resetMetrics();

    webhookCounter.labels('pull_request', 'opened').inc();
    jobsQueuedCounter.labels('test/repo').inc();
    jobsCompletedCounter.labels('success', 'test/repo').inc();
    queueDepthGauge.set({ state: 'waiting' }, 5);
    githubApiCallsCounter.labels('GET', '200', '/repos/:owner/:repo').inc();
    findingsGeneratedCounter.labels('rate_limit_retry', 'must').inc();

    const timer = jobDurationHistogram.startTimer({ repo: 'test/repo' });
    timer(); // Stop immediately

    const metrics = await getMetrics();

    // Verify all custom metrics are present
    expect(metrics).toContain('flowlint_webhook_received_total');
    expect(metrics).toContain('flowlint_jobs_queued_total');
    expect(metrics).toContain('flowlint_jobs_completed_total');
    expect(metrics).toContain('flowlint_job_duration_seconds');
    expect(metrics).toContain('flowlint_queue_depth');
    expect(metrics).toContain('flowlint_github_api_calls_total');
    expect(metrics).toContain('flowlint_findings_generated_total');
  });

  it('should include HTTP metrics from middleware', async () => {
    const metrics = await getMetrics();

    // HTTP metrics should be present (from prom-client default metrics or custom middleware)
    expect(metrics).toContain('http_request_duration_seconds');
  });

  it('should parse metrics correctly', async () => {
    register.resetMetrics();

    // Create specific metric values
    webhookCounter.labels('pull_request', 'opened').inc(3);
    jobsQueuedCounter.labels('owner/repo').inc(7);

    const metrics = await getMetrics();

    // Parse and verify specific values
    const lines = metrics.split('\n');
    const webhookLine = lines.find((line) =>
      line.includes('flowlint_webhook_received_total') &&
      line.includes('event_type="pull_request"') &&
      line.includes('action="opened"')
    );
    const jobLine = lines.find((line) =>
      line.includes('flowlint_jobs_queued_total') &&
      line.includes('repo="owner/repo"')
    );

    expect(webhookLine).toBeDefined();
    expect(webhookLine).toContain('3');

    expect(jobLine).toBeDefined();
    expect(jobLine).toContain('7');
  });

  it('should handle metric labels correctly', async () => {
    register.resetMetrics();

    // Test different label combinations
    findingsGeneratedCounter.labels('rate_limit_retry', 'must').inc();
    findingsGeneratedCounter.labels('error_handling', 'must').inc();
    findingsGeneratedCounter.labels('dead_ends', 'nit').inc();

    const metrics = await getMetrics();

    // Verify labels are properly formatted
    expect(metrics).toContain('rule="rate_limit_retry"');
    expect(metrics).toContain('rule="error_handling"');
    expect(metrics).toContain('rule="dead_ends"');
    expect(metrics).toContain('severity="must"');
    expect(metrics).toContain('severity="nit"');
  });

  it('should update queue depth gauge correctly', async () => {
    register.resetMetrics();

    queueDepthGauge.set({ state: 'waiting' }, 10);
    queueDepthGauge.set({ state: 'active' }, 2);
    queueDepthGauge.set({ state: 'failed' }, 1);

    const metrics = await getMetrics();

    expect(metrics).toContain('flowlint_queue_depth{state="waiting"} 10');
    expect(metrics).toContain('flowlint_queue_depth{state="active"} 2');
    expect(metrics).toContain('flowlint_queue_depth{state="failed"} 1');
  });

  it('should track GitHub API calls with method and status', async () => {
    register.resetMetrics();

    githubApiCallsCounter.labels('GET', '200', '/repos/:owner/:repo').inc();
    githubApiCallsCounter.labels('POST', '201', '/repos/:owner/:repo/check-runs').inc();
    githubApiCallsCounter.labels('PATCH', '200', '/repos/:owner/:repo/check-runs/:id').inc();
    githubApiCallsCounter.labels('GET', '404', '/repos/:owner/:repo/contents/.flowlint.yml').inc();

    const metrics = await getMetrics();

    expect(metrics).toContain('method="GET"');
    expect(metrics).toContain('method="POST"');
    expect(metrics).toContain('method="PATCH"');
    expect(metrics).toContain('status="200"');
    expect(metrics).toContain('status="201"');
    expect(metrics).toContain('status="404"');
  });

  it('should measure job duration histogram', async () => {
    register.resetMetrics();

    const timer = jobDurationHistogram.startTimer({ repo: 'test/repo' });
    await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate work
    timer();

    const metrics = await getMetrics();

    // Histogram should include count, sum, and bucket lines
    expect(metrics).toContain('flowlint_job_duration_seconds_count{repo="test/repo"} 1');
    expect(metrics).toContain('flowlint_job_duration_seconds_sum{repo="test/repo"}');
    expect(metrics).toContain('flowlint_job_duration_seconds_bucket');
  });

  describe('Performance Tests', () => {
    it('should return metrics in under 50ms', async () => {
      // Populate some metrics
      for (let i = 0; i < 10; i++) {
        webhookCounter.labels('pull_request', 'opened').inc();
        jobsQueuedCounter.labels(`repo${i}`).inc();
        findingsGeneratedCounter.labels(`rule${i}`, 'must').inc();
      }

      const start = Date.now();
      await getMetrics();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(50);
    });

    it('should handle concurrent metric collection', async () => {
      const promises = Array.from({ length: 10 }, () => getMetrics());
      const results = await Promise.all(promises);

      // All requests should succeed
      expect(results).toHaveLength(10);
      results.forEach((metrics) => {
        expect(typeof metrics).toBe('string');
        expect(metrics.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Metric Integrity', () => {
    it('should maintain counter values between metric reads', async () => {
      register.resetMetrics();

      webhookCounter.labels('pull_request', 'opened').inc();
      const metrics1 = await getMetrics();

      webhookCounter.labels('pull_request', 'opened').inc();
      const metrics2 = await getMetrics();

      // First read should show 1
      expect(metrics1).toContain('flowlint_webhook_received_total{event_type="pull_request",action="opened"} 1');

      // Second read should show 2 (cumulative)
      expect(metrics2).toContain('flowlint_webhook_received_total{event_type="pull_request",action="opened"} 2');
    });

    it('should handle gauge updates correctly', async () => {
      register.resetMetrics();

      queueDepthGauge.set({ state: 'waiting' }, 10);
      const metrics1 = await getMetrics();

      queueDepthGauge.set({ state: 'waiting' }, 5);
      const metrics2 = await getMetrics();

      // First read should show 10
      expect(metrics1).toContain('flowlint_queue_depth{state="waiting"} 10');

      // Second read should show 5 (last value)
      expect(metrics2).toContain('flowlint_queue_depth{state="waiting"} 5');
    });

    it('should reset metrics on registry reset', async () => {
      webhookCounter.labels('pull_request', 'opened').inc(5);
      register.resetMetrics();

      const metrics = await getMetrics();

      // After reset, counter should be 0 or not present in output
      const webhookLine = metrics
        .split('\n')
        .find((line) =>
          line.includes('flowlint_webhook_received_total') &&
          line.includes('event_type="pull_request"') &&
          line.includes('action="opened"') &&
          !line.startsWith('#')
        );

      // Either no line exists, or it shows 0
      if (webhookLine) {
        expect(webhookLine).toContain('0');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty metrics gracefully', async () => {
      register.resetMetrics();

      const metrics = await getMetrics();

      // Should still return valid Prometheus format with HELP/TYPE lines
      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
    });

    it('should handle special characters in labels', async () => {
      register.resetMetrics();

      // Prometheus should escape or handle special characters
      jobsQueuedCounter.labels('owner/repo-name').inc();

      const metrics = await getMetrics();

      expect(metrics).toContain('flowlint_jobs_queued_total');
      expect(metrics).toContain('owner/repo-name');
    });

    it('should handle very long label values', async () => {
      register.resetMetrics();

      const longRepoName = 'a'.repeat(200);
      jobsQueuedCounter.labels(longRepoName).inc();

      const metrics = await getMetrics();

      // Should still work without errors
      expect(metrics).toContain('flowlint_jobs_queued_total');
    });
  });
});
