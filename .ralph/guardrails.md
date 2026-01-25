# Guardrails - FlowLint GitHub App

## Rules

### G1: Never commit to main
- **Trigger:** `git commit` on main branch
- **Instruction:** Create feature branch (feat/, fix/, chore/, etc.)
- **Discovered:** Iteration 0

### G2: Always run tests before commit
- **Trigger:** Before every `git commit`
- **Instruction:** Run `npm test` and verify all tests pass
- **Discovered:** Iteration 0

### G3: Conventional Commits
- **Trigger:** Every commit message
- **Instruction:** Format `type(scope): description` - examples: `feat(api): add rate limiting`, `fix(worker): handle empty PR`
- **Discovered:** Iteration 0

### G4: Validate webhook signatures
- **Trigger:** Changes to webhook handling
- **Instruction:** NEVER skip HMAC signature validation - this is critical for security
- **Discovered:** Iteration 0

### G5: Test with real webhooks
- **Trigger:** Changes to API or worker
- **Instruction:** Use ngrok or similar to test with actual GitHub webhooks
- **Discovered:** Iteration 0

### G6: Job deduplication must work
- **Trigger:** Changes to job enqueuing
- **Instruction:** Verify job ID format `{owner}/{repo}#{pr}@{sha}` prevents duplicate processing
- **Discovered:** Iteration 0

### G7: Handle rate limits
- **Trigger:** Changes to GitHub API calls
- **Instruction:** Implement exponential backoff and respect X-RateLimit headers
- **Discovered:** Iteration 0

### G8: Use internal scope names
- **Trigger:** Commit message scope
- **Instruction:** Use internal module names (api, worker, github-client) not repo name (flowlint-github-app)
- **Discovered:** Iteration 0

### G9: Structured logging
- **Trigger:** Adding log statements
- **Instruction:** Use Pino structured logging with correlation IDs, never console.log
- **Discovered:** Iteration 0

### G10: Docker Compose must work
- **Trigger:** Changes to infrastructure
- **Instruction:** Run `docker-compose up` and verify all services start correctly
- **Discovered:** Iteration 0
