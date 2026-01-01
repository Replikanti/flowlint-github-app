import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../packages/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock observability
vi.mock('../../packages/observability', () => ({
  jobsQueuedCounter: {
    labels: vi.fn().mockReturnThis(),
    inc: vi.fn(),
  },
}));

describe('Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('should enqueue review job successfully', async () => {
    const { enqueueReview, setReviewQueue } = await import('../../apps/api/src/queue');

    const mockAdd = vi.fn().mockResolvedValue({ id: 'job-123' });
    setReviewQueue({ add: mockAdd });

    const job = {
      repo: 'owner/repo',
      prNumber: 1,
      sha: 'abc123',
      installationId: 456,
      branch: 'main',
    };

    await enqueueReview(job);

    expect(mockAdd).toHaveBeenCalledWith(
      'review',
      job,
      expect.objectContaining({
        jobId: 'owner/repo#1@abc123',
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
      }),
    );
  });

  it('should handle duplicate job gracefully', async () => {
    const { enqueueReview, setReviewQueue } = await import('../../apps/api/src/queue');

    const mockAdd = vi.fn().mockRejectedValue(new Error('Job already exists in queue'));
    setReviewQueue({ add: mockAdd });

    const job = {
      repo: 'owner/repo',
      prNumber: 1,
      sha: 'abc123',
      installationId: 456,
      branch: 'main',
    };

    const result = await enqueueReview(job);

    // Should return null for duplicates (not an error)
    expect(result).toBeNull();
  });

  it('should throw on unexpected queue errors', async () => {
    const { enqueueReview, setReviewQueue } = await import('../../apps/api/src/queue');

    const mockAdd = vi.fn().mockRejectedValue(new Error('Redis connection failed'));
    setReviewQueue({ add: mockAdd });

    const job = {
      repo: 'owner/repo',
      prNumber: 1,
      sha: 'abc123',
      installationId: 456,
      branch: 'main',
    };

    await expect(enqueueReview(job)).rejects.toThrow('Redis connection failed');
  });
});
