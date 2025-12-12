import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defaultConfig } from '@replikanti/flowlint-core';
import { runE2ETest } from './helpers/test-utils';
import * as FIXTURES from './helpers/fixtures';

describe('E2E Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Happy Path: processes a valid workflow and creates a neutral Check Run', { timeout: 20000 }, async () => {
    await runE2ETest({
      prFiles: [{ filename: 'workflows/valid.n8n.json', status: 'added', sha: 'sha123' }],
      fileContents: new Map([['sha123', FIXTURES.validWorkflow]]),
      testAssertions: ({ findings, conclusion, mockOctokit }) => {
        const mustFindings = findings.filter((f) => f.severity === 'must');
        expect(mustFindings).toHaveLength(0);
        expect(conclusion).not.toBe('failure');
        expect(mockOctokit._checkRunUpdates[0].conclusion).not.toBe('failure');
        expect(mockOctokit._checkRunUpdates[0].status).toBe('completed');
      },
    });
  });

  it('Critical Findings: fails Check Run when a "must" rule is violated', { timeout: 10000 }, async () => {
    await runE2ETest({
      prFiles: [{ filename: 'workflows/unsafe.n8n.json', status: 'added', sha: 'sha456' }],
      fileContents: new Map([['sha456', FIXTURES.continueOnFailWorkflow]]),
      jobOverrides: { prNumber: 2, sha: 'def456' },
      testAssertions: ({ findings, conclusion, mockOctokit }) => {
        const r2Finding = findings.find((f) => f.rule === 'R2');
        expect(r2Finding).toBeDefined();
        expect(r2Finding?.severity).toBe('must');
        expect(conclusion).toBe('failure');
        expect(mockOctokit._checkRunUpdates[0].conclusion).toBe('failure');
      },
    });
  });

  it('Config Override: does not trigger a disabled rule', { timeout: 10000 }, async () => {
    const customConfig = 'rules:\n  error_handling:\n    enabled: false\n';
    await runE2ETest({
      prFiles: [{ filename: 'workflows/unsafe.n8n.json', status: 'added', sha: 'sha789' }],
      fileContents: new Map([['sha789', FIXTURES.continueOnFailWorkflow]]),
      configContent: customConfig,
      jobOverrides: { prNumber: 3, sha: 'ghi789' },
      testAssertions: ({ findings }) => {
        const r2Finding = findings.find((f) => f.rule === 'R2');
        expect(r2Finding).toBeUndefined();
      },
    });
  });

  it('Error Scenarios: creates a FETCH finding when a file fetch fails', { timeout: 10000 }, async () => {
    await runE2ETest({
      prFiles: [{ filename: 'workflows/missing.n8n.json', status: 'added', sha: 'sha404' }],
      fileContents: new Map(), // Empty map causes fetch to fail
      jobOverrides: { prNumber: 4, sha: 'jkl404' },
      testAssertions: ({ findings }) => {
        expect(findings).toHaveLength(1);
        expect(findings[0].rule).toBe('FETCH');
        expect(findings[0].message).toContain('Failed to fetch file content');
      },
    });
  });

  it('Error Scenarios: creates a PARSE finding when workflow JSON is malformed', { timeout: 10000 }, async () => {
    await runE2ETest({
      prFiles: [{ filename: 'workflows/malformed.n8n.json', status: 'added', sha: 'sha999' }],
      fileContents: new Map([['sha999', FIXTURES.malformedWorkflow]]),
      jobOverrides: { prNumber: 5, sha: 'mno999' },
      testAssertions: ({ findings }) => {
        const parseFinding = findings.find((f) => f.rule === 'PARSE');
        expect(parseFinding).toBeDefined();
        expect(parseFinding?.severity).toBe('must');
        expect(parseFinding?.line).toBe(1);
      },
    });
  });

  it('Realistic Workflow: parses files exported without node IDs', { timeout: 10000 }, async () => {
    await runE2ETest({
      prFiles: [{ filename: 'workflows/no-ids.n8n.json', status: 'added', sha: 'sha100' }],
      fileContents: new Map([['sha100', FIXTURES.workflowWithoutIds]]),
      jobOverrides: { prNumber: 6, sha: 'node100' },
      testAssertions: ({ findings }) => {
        expect(findings.some((f) => f.rule === 'PARSE')).toBe(false);
      },
    });
  });

  it('Realistic Workflow: accepts tag objects exported by n8n', { timeout: 10000 }, async () => {
    await runE2ETest({
      prFiles: [{ filename: 'workflows/tags.n8n.json', status: 'added', sha: 'sha101' }],
      fileContents: new Map([['sha101', FIXTURES.workflowWithObjectTags]]),
      jobOverrides: { prNumber: 7, sha: 'tag101' },
      testAssertions: ({ findings }) => {
        expect(findings.some((f) => f.rule === 'PARSE')).toBe(false);
      },
    });
  });

  it('File Filtering: includes only files matching the default glob pattern', { timeout: 10000 }, async () => {
    await runE2ETest({
      prFiles: [
        { filename: 'workflows/include-me.n8n.json', status: 'added', sha: 'sha1' },
        { filename: 'samples/exclude-me.n8n.json', status: 'added', sha: 'sha2' },
        { filename: 'package.json', status: 'modified', sha: 'sha3' },
      ],
      fileContents: new Map([
        ['sha1', FIXTURES.validWorkflow],
        ['sha2', FIXTURES.validWorkflow],
      ]),
      jobOverrides: { prNumber: 6, sha: 'pqr111' },
      testAssertions: ({ targets }) => {
        expect(targets).toHaveLength(1);
        expect(targets[0].filename).toBe('workflows/include-me.n8n.json');
      },
    });
  });

  it('All Rules: triggers multiple rules on a workflow with many violations', { timeout: 10000 }, async () => {
    await runE2ETest({
      prFiles: [{ filename: 'workflows/violations.n8n.json', status: 'added', sha: 'sha777' }],
      fileContents: new Map([['sha777', FIXTURES.multipleViolationsWorkflow]]),
      jobOverrides: { prNumber: 7, sha: 'stu777' },
      testAssertions: ({ findings }) => {
        expect(findings.length).toBeGreaterThan(3);
        expect(findings.some((f) => f.rule === 'R2' && f.severity === 'must')).toBe(true);
        expect(findings.some((f) => f.rule === 'R10' && f.severity === 'nit')).toBe(true);
        expect(findings.some((f) => f.rule === 'R12' && f.severity === 'must')).toBe(true);
      },
    });
  });

  it('No Target Files: supersedes older FlowLint checks when no relevant files found', { timeout: 10000 }, async () => {
    await runE2ETest({
      prFiles: [{ filename: 'package.json', status: 'modified', sha: 'sha123' }], // Non-workflow file
      fileContents: new Map([['sha123', '{"name": "test"}']]),
      jobOverrides: { prNumber: 8, sha: 'no-files-123' },
      configContent: undefined, // Use default config
      testAssertions: ({ findings, conclusion, mockOctokit }) => {
        expect(findings).toHaveLength(0);
        expect(conclusion).toBe('neutral');
        
        // Verify the check run was created with "No relevant files found" message
        const checkUpdate = mockOctokit._checkRunUpdates[0];
        expect(checkUpdate.conclusion).toBe('neutral');
        expect(checkUpdate.output.title).toBe('No relevant files found');
        expect(checkUpdate.output.summary).toBe('No workflow files were found to analyze in this pull request.');
        
        // Verify older runs were marked as superseded
        const supersededRuns = mockOctokit._checkRunUpdates.filter((update: any) => 
          update.output?.title === 'Superseded by newer FlowLint run'
        );
        expect(supersededRuns.length).toBeGreaterThan(0);
        expect(supersededRuns[0].output.summary).toContain('This run has been replaced by FlowLint check');
      },
      mockConfig: {
        existingFlowLintChecks: [
          { id: 999, status: 'completed', conclusion: 'neutral' }
        ]
      }
    });
  });

  describe('Snapshot Testing: Check Run payloads', () => {
    it('generates consistent Check Run output for a valid workflow', async () => {
      const { buildCheckOutput } = await import('@replikanti/flowlint-core')
      const findings = [{ rule: 'R10', severity: 'nit' as const, path: 'workflows/test.json', message: 'Generic node name detected', nodeId: '1' }];
      const output = buildCheckOutput({ findings, cfg: defaultConfig });
      expect(output).toMatchSnapshot();
    });

    it('generates consistent Check Run output for critical violations', async () => {
      const { buildCheckOutput } = await import('@replikanti/flowlint-core')
      const findings = [{ rule: 'R2', severity: 'must' as const, path: 'workflows/test.json', message: 'continueOnFail is forbidden', nodeId: '1' }];
      const output = buildCheckOutput({ findings, cfg: defaultConfig });
      expect(output).toMatchSnapshot();
      expect(output.conclusion).toBe('failure');
    });
  });
});
