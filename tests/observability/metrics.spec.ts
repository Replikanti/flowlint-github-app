import { describe, it, expect, beforeEach } from 'vitest';
import {
  register,
  webhookCounter,
  jobsQueuedCounter,
  jobsCompletedCounter,
  jobDurationHistogram,
  queueDepthGauge,
  githubApiCallsCounter,
  findingsGeneratedCounter,
} from '../../packages/observability/metrics';

/**
 * Unit tests for Prometheus metrics
 *
 * Tests the core metrics functionality including:
 * - Counter increments
 * - Histogram observations
 * - Gauge updates
 * - Metric registration
 */

describe('Observability Metrics - Unit Tests', () => {
  beforeEach(async () => {
    // Reset metrics registry before each test
    register.resetMetrics();
  });

  describe('webhookCounter', () => {
    it('should increment counter for pull_request events', async () => {
      webhookCounter.labels('pull_request', 'opened').inc();
      webhookCounter.labels('pull_request', 'synchronize').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_webhook_received_total{event_type="pull_request",action="opened"} 1');
      expect(metrics).toContain('flowlint_webhook_received_total{event_type="pull_request",action="synchronize"} 1');
    });

    it('should track multiple event types separately', async () => {
      webhookCounter.labels('pull_request', 'opened').inc();
      webhookCounter.labels('check_suite', 'requested').inc();
      webhookCounter.labels('check_suite', 'requested').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_webhook_received_total{event_type="pull_request",action="opened"} 1');
      expect(metrics).toContain('flowlint_webhook_received_total{event_type="check_suite",action="requested"} 2');
    });

    it('should handle custom action values', async () => {
      webhookCounter.labels('custom_event', 'unknown').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_webhook_received_total{event_type="custom_event",action="unknown"} 1');
    });
  });

  describe('jobDurationHistogram', () => {
    it('should record job duration in correct buckets', async () => {
      const timer = jobDurationHistogram.startTimer({ repo: 'test/repo' });

      // Simulate some work delay
      await new Promise(resolve => setTimeout(resolve, 50));
      timer(); // Stop timer

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_job_duration_seconds_count{repo="test/repo"} 1');
      expect(metrics).toContain('flowlint_job_duration_seconds_sum{repo="test/repo"}');
    });

    it('should track multiple job durations', async () => {
      const timer1 = jobDurationHistogram.startTimer({ repo: 'test/repo1' });
      await new Promise(resolve => setTimeout(resolve, 10));
      timer1();

      const timer2 = jobDurationHistogram.startTimer({ repo: 'test/repo2' });
      await new Promise(resolve => setTimeout(resolve, 10));
      timer2();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_job_duration_seconds_count{repo="test/repo1"} 1');
      expect(metrics).toContain('flowlint_job_duration_seconds_count{repo="test/repo2"} 1');
    });
  });

  describe('queueDepthGauge', () => {
    it('should update gauge value', async () => {
      queueDepthGauge.set({ state: 'waiting' }, 5);

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_queue_depth{state="waiting"} 5');
    });

    it('should handle zero values', async () => {
      queueDepthGauge.set({ state: 'active' }, 0);

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_queue_depth{state="active"} 0');
    });

    it('should update existing gauge value', async () => {
      queueDepthGauge.set({ state: 'failed' }, 10);
      queueDepthGauge.set({ state: 'failed' }, 15);

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_queue_depth{state="failed"} 15');
    });
  });

  describe('githubApiCallsCounter', () => {
    it('should increment on GitHub API call', async () => {
      githubApiCallsCounter.labels('GET', '200', '/repos/:owner/:repo').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_github_api_calls_total{method="GET",status="200",endpoint="/repos/:owner/:repo"} 1');
    });

    it('should track different HTTP methods separately', async () => {
      githubApiCallsCounter.labels('GET', '200', '/repos/:owner/:repo').inc();
      githubApiCallsCounter.labels('POST', '201', '/repos/:owner/:repo/check-runs').inc();
      githubApiCallsCounter.labels('PATCH', '200', '/repos/:owner/:repo/check-runs/:id').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_github_api_calls_total{method="GET",status="200",endpoint="/repos/:owner/:repo"} 1');
      expect(metrics).toContain('flowlint_github_api_calls_total{method="POST",status="201",endpoint="/repos/:owner/:repo/check-runs"} 1');
      expect(metrics).toContain('flowlint_github_api_calls_total{method="PATCH",status="200",endpoint="/repos/:owner/:repo/check-runs/:id"} 1');
    });
  });

  describe('findingsGeneratedCounter', () => {
    it('should increment when finding generated', async () => {
      findingsGeneratedCounter.labels('rate_limit_retry', 'must').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_findings_generated_total{rule="rate_limit_retry",severity="must"} 1');
    });

    it('should track different rules separately', async () => {
      findingsGeneratedCounter.labels('rate_limit_retry', 'must').inc();
      findingsGeneratedCounter.labels('error_handling', 'must').inc();
      findingsGeneratedCounter.labels('idempotency', 'must').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_findings_generated_total{rule="rate_limit_retry",severity="must"} 1');
      expect(metrics).toContain('flowlint_findings_generated_total{rule="error_handling",severity="must"} 1');
      expect(metrics).toContain('flowlint_findings_generated_total{rule="idempotency",severity="must"} 1');
    });

    it('should track different severities separately', async () => {
      findingsGeneratedCounter.labels('rate_limit_retry', 'must').inc();
      findingsGeneratedCounter.labels('dead_ends', 'nit').inc();
      findingsGeneratedCounter.labels('long_running', 'should').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_findings_generated_total{rule="rate_limit_retry",severity="must"} 1');
      expect(metrics).toContain('flowlint_findings_generated_total{rule="dead_ends",severity="nit"} 1');
      expect(metrics).toContain('flowlint_findings_generated_total{rule="long_running",severity="should"} 1');
    });
  });

  describe('jobsQueuedCounter', () => {
    it('should increment when job queued', async () => {
      jobsQueuedCounter.labels('test/repo').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_jobs_queued_total{repo="test/repo"} 1');
    });
  });

  describe('jobsCompletedCounter', () => {
    it('should increment when job completed', async () => {
      jobsCompletedCounter.labels('success', 'test/repo').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_jobs_completed_total{status="success",repo="test/repo"} 1');
    });

    it('should track successes and failures separately', async () => {
      jobsCompletedCounter.labels('success', 'test/repo1').inc();
      jobsCompletedCounter.labels('success', 'test/repo1').inc();
      jobsCompletedCounter.labels('failure', 'test/repo2').inc();

      const metrics = await register.metrics();
      expect(metrics).toContain('flowlint_jobs_completed_total{status="success",repo="test/repo1"} 2');
      expect(metrics).toContain('flowlint_jobs_completed_total{status="failure",repo="test/repo2"} 1');
    });
  });
});
