import type { Octokit } from 'octokit';
import type { PRFile } from './types';
import { logger } from '../logger';
import micromatch from 'micromatch';

export type GlobSet = { include: string[]; ignore: string[] };

export function pickTargets(files: PRFile[], globs: GlobSet) {
  return files
    .filter((file) => file.status !== 'removed')
    .filter((file) => {
      const normalized = file.filename.replace(/\\/g, '/');
      const included = micromatch.isMatch(normalized, globs.include, { dot: true });
      const ignored = micromatch.isMatch(normalized, globs.ignore, { dot: true });
      return included && !ignored;
    });
}

export type FetchResult = {
  contents: Map<string, string>;
  errors: Array<{ filename: string; error: string }>;
};

export async function fetchRawFiles(
  gh: Octokit,
  repoFull: string,
  targets: PRFile[],
): Promise<FetchResult> {
  const [owner, repo] = repoFull.split('/');
  const contents = new Map<string, string>();
  const errors: Array<{ filename: string; error: string }> = [];

  for (const file of targets) {
    if (!file.sha) {
      errors.push({ filename: file.filename, error: 'Missing SHA (file may be removed)' });
      continue;
    }

    try {
      const { data: blob } = await gh.request('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', {
        owner,
        repo,
        file_sha: file.sha,
      });
      const raw = Buffer.from(blob.content, 'base64').toString('utf8');
      contents.set(file.filename, raw);
    } catch (error) {
      // Handle transient errors (404, timeouts, rate limits) gracefully
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn({ filename: file.filename, error: errorMsg }, 'failed to fetch file');
      errors.push({ filename: file.filename, error: errorMsg });
    }
  }

  return { contents, errors };
}
