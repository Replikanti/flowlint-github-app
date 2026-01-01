import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfigFromGitHub } from '../../packages/github/config-loader';

describe('Config Loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load config from .flowlint.yml', async () => {
    const mockOctokit = {
      request: vi.fn().mockResolvedValue({
        data: {
          content: Buffer.from('files:\n  include:\n    - "*.json"').toString('base64'),
        },
      }),
    };

    const config = await loadConfigFromGitHub(mockOctokit as any, 'owner/repo', 'sha123');

    expect(config.files.include).toContain('*.json');
  });

  it('should try multiple config file candidates', async () => {
    const mockOctokit = {
      request: vi.fn()
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce({
          data: {
            content: Buffer.from('files:\n  include:\n    - "*.yaml"').toString('base64'),
          },
        }),
    };

    const config = await loadConfigFromGitHub(mockOctokit as any, 'owner/repo', 'sha123');

    expect(config.files.include).toContain('*.yaml');
    expect(mockOctokit.request).toHaveBeenCalledTimes(2);
  });

  it('should return default config when no config file found', async () => {
    const mockOctokit = {
      request: vi.fn().mockRejectedValue(new Error('Not found')),
    };

    const config = await loadConfigFromGitHub(mockOctokit as any, 'owner/repo', 'sha123');

    expect(config).toBeDefined();
    expect(config.files).toBeDefined();
  });

  it('should handle response without content field', async () => {
    const mockOctokit = {
      request: vi.fn()
        .mockResolvedValueOnce({
          data: {
            type: 'dir', // Directory response, no content field
            name: '.flowlint.yml',
          },
        })
        .mockRejectedValueOnce(new Error('Not found'))
        .mockRejectedValueOnce(new Error('Not found')),
    };

    const config = await loadConfigFromGitHub(mockOctokit as any, 'owner/repo', 'sha123');

    // Should fall back to default config
    expect(config).toBeDefined();
    expect(mockOctokit.request).toHaveBeenCalledTimes(3);
  });

  it('should handle response with non-string content', async () => {
    const mockOctokit = {
      request: vi.fn()
        .mockResolvedValueOnce({
          data: {
            content: 12345, // Not a string
          },
        })
        .mockRejectedValueOnce(new Error('Not found'))
        .mockRejectedValueOnce(new Error('Not found')),
    };

    const config = await loadConfigFromGitHub(mockOctokit as any, 'owner/repo', 'sha123');

    // Should fall back to default config
    expect(config).toBeDefined();
    expect(mockOctokit.request).toHaveBeenCalledTimes(3);
  });
});
