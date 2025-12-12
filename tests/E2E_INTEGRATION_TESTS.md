# E2E Integration Tests

This document describes the comprehensive End-to-End (E2E) integration test suite for FlowLint, covering the full webhook → queue → worker → Check Run pipeline.

## Overview

The E2E tests validate the complete review pipeline flow, from GitHub webhook ingestion to Check Run completion, including all error scenarios and edge cases. These tests are critical for ensuring system reliability and correctness before deployment.

**Test Files:**
- `tests/e2e-integration.spec.ts` - Core E2E scenarios (12 tests)
- `tests/e2e-advanced.spec.ts` - Advanced scenarios (13 tests)

**Total Tests:** 25 E2E integration tests
**Execution Time:** ~40-50 seconds (full suite)

## Test Architecture

### Mocking Strategy

The E2E tests use a comprehensive mocking approach to simulate GitHub API and Redis interactions without requiring external services:

1. **Octokit Mocking**: Custom `createMockOctokit()` factory creates deterministic GitHub API responses
2. **Redis Mocking**: Queue operations mocked via `setReviewQueue()` utility
3. **File Fixtures**: Sample n8n workflows with known anti-patterns stored as JSON strings

### Mock Octokit Configuration

```typescript
type MockOctokitConfig = {
  checkRunId: number;              // ID for created check runs
  prFiles: PRFile[];               // List of files in PR
  fileContents: Map<string, string>; // File SHA → content mapping
  configContent: string | null;    // .flowlint.yml content
  shouldFailCheckRunCreation: boolean;
  shouldFailFilesFetch: boolean;
  shouldTimeout: boolean;
  shouldRateLimit: boolean;
};
```

## Test Fixtures

Pre-defined workflow samples for consistent testing:

| Fixture | Description | Violations |
|---------|-------------|-----------|
| `validWorkflow` | Properly configured workflow with error handling | None (neutral) |
| `continueOnFailWorkflow` | Uses forbidden continueOnFail flag | R2 (must) |
| `secretLeakWorkflow` | Contains hardcoded API key | R4 (must) |
| `unhandledErrorWorkflow` | Missing error path on API node | R12 (must) |
| `malformedWorkflow` | Invalid JSON syntax | Parse error |
| `multipleViolationsWorkflow` | Triggers R2, R10, R12 | Multiple |

## Test Scenarios

### Core E2E Tests (`e2e-integration.spec.ts`)

#### 1. Happy Path
**Test:** `processes a valid workflow and creates neutral Check Run`
**Validates:**
- Check Run creation with `in_progress` status
- File filtering via glob patterns
- Graph parsing from n8n JSON
- Rule execution (all 12 rules)
- Check Run completion with `neutral` conclusion

#### 2. Critical Findings
**Test:** `fails Check Run when continueOnFail is detected`
**Validates:**
- R2 rule detection (continueOnFail violation)
- Check Run conclusion set to `failure`
- Must-severity findings block PR

#### 3. Config Override
**Test:** `does not trigger disabled rule when config overrides it`
**Validates:**
- `.flowlint.yml` loading from repository
- Config deep merge with defaults
- Rule enable/disable toggle

#### 4. GitHub API Failures
**Test:** `creates FETCH finding when file fetch fails`
**Validates:**
- Graceful handling of 404 responses
- FETCH finding generation
- Partial processing continues

**Test:** `creates PARSE finding when workflow JSON is malformed`
**Validates:**
- JSON parse error catching
- PARSE finding generation
- Error doesn't crash worker

#### 5. File Filtering
**Test:** `includes only files matching include pattern`
**Validates:**
- Glob pattern matching
- Default ignore patterns (samples/, package.json, .github/)

#### 6. All 12 Rules
**Test:** `triggers multiple rules on workflow with violations`
**Validates:**
- All rules run in parallel
- Multiple findings aggregated correctly
- Severity priorities (must > should > nit)

#### 7. Duplicate Webhook
**Test:** `returns null for duplicate job ID`
**Validates:**
- Job deduplication via `${repo}#${prNumber}@${sha}`
- Duplicate webhooks handled gracefully

#### 8. Snapshot Testing
**Tests:** Check Run output consistency
**Validates:**
- Output structure stability
- Summary text format
- Conclusion inference

#### 9. Annotation Batching
**Test:** `batches annotations in groups of 50`
**Validates:**
- GitHub API 50-annotation limit compliance
- Large finding sets handled

#### 10. Performance
**Test:** `completes full E2E cycle in under 5 seconds`
**Validates:**
- Acceptable CI overhead
- No performance regressions

### Advanced E2E Tests (`e2e-advanced.spec.ts`)

#### 1. GitHub API Rate Limiting
**Test:** `handles primary rate limit gracefully`
**Validates:**
- 403 rate limit error detection
- x-ratelimit-remaining header handling

**Test:** `respects retry-after header on rate limit`
**Validates:**
- Retry-After header parsing
- Backoff timing

#### 2. Graceful Shutdown
**Test:** `waits for active jobs to complete before shutdown`
**Validates:**
- SIGTERM signal handling
- Job completion before exit
- 45-second grace period

**Test:** `respects graceful shutdown timeout`
**Validates:**
- Forced kill after timeout
- Worker process cleanup

#### 3. Redis Connection Failures
**Test:** `handles Redis connection timeout gracefully`
**Validates:**
- ETIMEDOUT error handling
- Job enqueue failure

**Test:** `handles Redis disconnection during job processing`
**Validates:**
- Mid-processing Redis failures
- Partial recovery

#### 4. Large File Processing
**Test:** `handles workflow files exceeding 2MB limit`
**Validates:**
- Parser scalability (10,000 nodes)
- Memory efficiency

**Test:** `limits annotation raw_details to 64KB GitHub limit`
**Validates:**
- raw_details truncation
- GitHub API compliance

#### 5. Concurrent PR Processing
**Test:** `processes multiple PRs in parallel without interference`
**Validates:**
- Isolated job contexts
- No cross-contamination

#### 6. Check Run Superseding
**Test:** `marks previous check runs as superseded`
**Validates:**
- Old run detection
- Neutral conclusion with supersede message
- Prevents duplicate results

#### 7. Summary Limit Enforcement
**Test:** `respects summary_limit config for annotations`
**Validates:**
- Annotation limiting (default: 25)
- Summary text includes total count

**Test:** `disables summary_limit when set to 0`
**Validates:**
- Unlimited annotation mode

#### 8. Job Retry Logic
**Test:** `retries failed jobs with exponential backoff`
**Validates:**
- 3 retry attempts
- Exponential backoff (2000ms base)

## Running the Tests

### Run E2E Tests Only
```bash
npm test -- tests/e2e-integration.spec.ts
npm test -- tests/e2e-advanced.spec.ts
```

### Run All Tests
```bash
npm test
```

Expected output:
```
Test Files  9 passed (9)
Tests       102 passed (102)
Duration    ~40s
```

### CI Integration

E2E tests run automatically on every PR via `.github/workflows/ci.yml`:

```yaml
- name: Run tests
  run: npm test
```

**CI Performance:** ~30-40 seconds additional overhead (acceptable for comprehensive coverage)

## Snapshot Testing

Snapshots are stored in `tests/__snapshots__/e2e-integration.spec.ts.snap`.

### Update Snapshots
```bash
npx vitest -u tests/e2e-integration.spec.ts
```

### Snapshot Examples
- Valid workflow → `{ conclusion: "success", output: { summary: "0 must-fix, 0 should-fix, 1 nit." } }`
- Critical violation → `{ conclusion: "failure", output: { summary: "1 must-fix, 0 should-fix, 0 nit." } }`

## Coverage

### Pipeline Stages Covered
- [x] Webhook signature verification
- [x] Rate limiting (100 req/min)
- [x] Job enqueuing with deduplication
- [x] Check Run creation (in_progress)
- [x] Config loading from repository
- [x] File filtering (glob patterns)
- [x] Blob fetching (paginated)
- [x] n8n JSON parsing
- [x] Graph traversal
- [x] Rule execution (all 12 rules)
- [x] Annotation batching (50 per request)
- [x] Check Run completion
- [x] Old run superseding

### Error Scenarios Covered
- [x] GitHub API timeouts
- [x] GitHub API rate limits (primary + secondary)
- [x] File fetch 404 errors
- [x] Malformed JSON parsing
- [x] Redis connection failures
- [x] Redis disconnection mid-job
- [x] Large file handling (>2MB)
- [x] Graceful shutdown (SIGTERM)
- [x] Job retry with exponential backoff

### Edge Cases Covered
- [x] Duplicate webhooks (same SHA)
- [x] Multiple PRs in parallel
- [x] Config override (`.flowlint.yml`)
- [x] Empty PR (no workflow files)
- [x] 100+ annotations (batching)
- [x] Summary limit enforcement

## Best Practices

1. **Timeout Configuration**: Long-running E2E tests use `{ timeout: 30000 }` to avoid false failures
2. **Mock Isolation**: Each test creates fresh mock instances to prevent state leakage
3. **Deterministic Fixtures**: All test workflows use fixed JSON strings, not dynamic generation
4. **Snapshot Validation**: Check Run outputs are snapshot-tested to detect unintended changes
5. **Performance Budgets**: E2E tests must complete in <5 seconds per scenario

## Troubleshooting

### Test Timeout
**Symptom:** `Error: Test timed out in 5000ms`
**Solution:** Add `{ timeout: 30000 }` to test definition

### Mock Not Applied
**Symptom:** `Error: APP_PRIVATE_KEY_PEM_BASE64 is not set`
**Solution:** Ensure `vi.spyOn(..., 'getInstallationClient').mockResolvedValue(mockOctokit)` is called before test

### Snapshot Mismatch
**Symptom:** `Snapshot ... mismatched`
**Solution:** Review changes, update snapshots with `npx vitest -u` if intentional

### Unhandled Error
**Symptom:** `Vitest caught 1 unhandled error`
**Solution:** Check test logs for actual error; timeout warnings can be ignored

## Future Enhancements

- [ ] Integration with real Redis instance (via Docker Compose)
- [ ] Mock GitHub webhook server for API validation
- [ ] Performance benchmarking across releases
- [ ] Chaos engineering tests (random failures)
- [ ] Multi-repository test scenarios

## Related Documentation

- [AGENTS.md](../AGENTS.md) - Build specification and architecture
- [RULES.md](../RULES.md) - Rule documentation
- [DEPLOYMENT.md](../DEPLOYMENT.md) - On-prem deployment guide
- [README.md](../README.md) - Project overview
