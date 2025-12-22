import OpenAI from 'openai';
import { Octokit } from '@octokit/rest';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TAG_NAME = process.env.TAG_NAME;
const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');

if (!OPENAI_API_KEY || !GITHUB_TOKEN || !TAG_NAME || !OWNER || !REPO) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function main() {
  try {
    console.log(`Fetching release ${TAG_NAME} for ${OWNER}/${REPO}...`);
    const release = await octokit.repos.getReleaseByTag({
      owner: OWNER,
      repo: REPO,
      tag: TAG_NAME as string,
    });

    const originalNotes = release.data.body || '';
    const prompt = `You are a Developer Relations expert... (omitted for brevity) ... ${originalNotes}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    const newNotes = response.choices[0].message.content?.trim();

    if (newNotes && newNotes !== originalNotes) {
      await octokit.repos.updateRelease({
        owner: OWNER,
        repo: REPO,
        release_id: release.data.id,
        body: newNotes,
      });
    }
  } catch (error) {
    console.error('Error polishing release notes:', error);
    process.exit(1);
  }
}

main();