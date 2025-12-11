import type { Octokit } from 'octokit';
import { parseConfig, defaultConfig } from '@replikanti/flowlint-core';
import type { FlowLintConfig } from '@replikanti/flowlint-core';

export async function loadConfigFromGitHub(
  gh: Octokit,
  repoFull: string,
  sha: string
): Promise<FlowLintConfig> {
  const [owner, repo] = repoFull.split('/');
  const candidates = ['.flowlint.yml', '.flowlint.yaml', 'flowlint.config.yml'];

  for (const path of candidates) {
    try {
      const { data } = await gh.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path,
        ref: sha,
      });

      if ('content' in data && typeof data.content === 'string') {
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return parseConfig(content);
      }
    } catch (error) {
      // Ignore 404, try next candidate
      continue;
    }
  }

  return defaultConfig;
}
