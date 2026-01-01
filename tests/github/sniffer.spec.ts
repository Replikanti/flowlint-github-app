import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickTargets, fetchRawFiles } from '../../packages/github/sniffer';
import type { PRFile } from '../../packages/github/types';

// Mock logger
vi.mock('../../packages/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

// Helper to create mock PRFile objects
function createMockPRFile(overrides: Partial<PRFile>): PRFile {
  return {
    filename: 'test.json',
    status: 'modified',
    sha: 'abc123',
    additions: 0,
    deletions: 0,
    changes: 0,
    blob_url: 'https://github.com/blob',
    raw_url: 'https://github.com/raw',
    contents_url: 'https://api.github.com/contents',
    ...overrides,
  };
}

describe('GitHub Sniffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pickTargets', () => {
    it('should filter files by include patterns', () => {
      const files: PRFile[] = [
        createMockPRFile({ filename: 'workflow.json' }),
        createMockPRFile({ filename: 'src/index.ts' }),
      ];
      const globs = { include: ['*.json'], ignore: [] };

      const result = pickTargets(files, globs);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('workflow.json');
    });

    it('should exclude files by ignore patterns', () => {
      const files: PRFile[] = [
        createMockPRFile({ filename: 'workflow.json' }),
        createMockPRFile({ filename: 'node_modules/lib.json' }),
      ];
      const globs = { include: ['**/*.json'], ignore: ['node_modules/**'] };

      const result = pickTargets(files, globs);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('workflow.json');
    });

    it('should filter out removed files', () => {
      const files: PRFile[] = [
        createMockPRFile({ filename: 'workflow.json', status: 'removed' }),
        createMockPRFile({ filename: 'other.json' }),
      ];
      const globs = { include: ['*.json'], ignore: [] };

      const result = pickTargets(files, globs);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('other.json');
    });
  });

  describe('fetchRawFiles', () => {
    it('should fetch file contents successfully', async () => {
      const mockOctokit = {
        request: vi.fn().mockResolvedValue({
          data: { content: Buffer.from('{"test":"data"}').toString('base64') },
        }),
      };

      const result = await fetchRawFiles(
        mockOctokit as any,
        'owner/repo',
        [createMockPRFile({ filename: 'workflow.json' })]
      );

      expect(result.contents.size).toBe(1);
      expect(result.contents.get('workflow.json')).toBe('{"test":"data"}');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle files with missing SHA', async () => {
      const mockOctokit = { request: vi.fn() };

      const result = await fetchRawFiles(
        mockOctokit as any,
        'owner/repo',
        [createMockPRFile({ sha: undefined as any })]
      );

      expect(result.contents.size).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Missing SHA');
      expect(mockOctokit.request).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      const mockOctokit = {
        request: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      };

      const result = await fetchRawFiles(
        mockOctokit as any,
        'owner/repo',
        [createMockPRFile({ filename: 'workflow.json' })]
      );

      expect(result.contents.size).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('API rate limit exceeded');
    });

    it('should handle multiple files with mixed success', async () => {
      const mockOctokit = {
        request: vi.fn()
          .mockResolvedValueOnce({ data: { content: Buffer.from('success').toString('base64') } })
          .mockRejectedValueOnce(new Error('Not found')),
      };

      const result = await fetchRawFiles(mockOctokit as any, 'owner/repo', [
        createMockPRFile({ filename: 'file1.json' }),
        createMockPRFile({ filename: 'file2.json' }),
      ]);

      expect(result.contents.size).toBe(1);
      expect(result.contents.get('file1.json')).toBe('success');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].filename).toBe('file2.json');
    });
  });
});
