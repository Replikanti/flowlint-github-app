import { Queue } from 'bullmq';
import { logger } from 'packages/logger';
import { jobsQueuedCounter } from 'packages/observability';

export type ReviewJob = {
  installationId: number;
  repo: string; // owner/name
  prNumber: number;
  sha: string;
  checkRunId?: number;
  headBranch?: string;
  checkSuiteId?: number;
};

const connection = {
  connection: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
};

const isTestEnv = process.env.NODE_ENV === 'test';

let reviewQueue: Queue<ReviewJob> = isTestEnv
  ? ({
      add: async () => {
        throw new Error('Mock queue not configured');
      },
    } as unknown as Queue<ReviewJob>)
  : new Queue<ReviewJob>('review', connection);

export const getReviewQueue = () => reviewQueue;

export function setReviewQueue(mock: Pick<Queue<ReviewJob>, 'add'>) {
  if (isTestEnv) {
    reviewQueue = mock as Queue<ReviewJob>;
  }
}

export async function enqueueReview(job: ReviewJob) {
  const jobId = `${job.repo}#${job.prNumber}@${job.sha}`;

  logger.info({
    jobId,
    repo: job.repo,
    prNumber: job.prNumber,
    sha: job.sha.substring(0, 7),
  }, 'enqueueing review job');

  try {
    const result = await reviewQueue.add('review', job, {
      jobId,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    // Increment jobs queued counter
    jobsQueuedCounter.labels(job.repo).inc();

    return result;
  } catch (error) {
    // GitHub fires multiple webhooks (pull_request + check_suite) for the same SHA
    // If job already exists, treat as success (de-duplication working as intended)
    if (error instanceof Error && error.message.toLowerCase().includes('already exists')) {
      logger.debug({ jobId }, 'job already exists (deduplication)');
      return null; // Indicate duplicate, but not an error
    }
    throw error; // Re-throw unexpected errors
  }
}
