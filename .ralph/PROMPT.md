# Ralph Loop - FlowLint GitHub App

## Task

Development and maintenance of FlowLint GitHub App - automated PR-based linting via GitHub Check Runs.

## Completion Criteria

- [ ] API receives and validates GitHub webhooks
- [ ] Worker processes jobs from queue
- [ ] Check Runs posted correctly with annotations
- [ ] Job deduplication works
- [ ] Tests pass
- [ ] Docker Compose stack runs successfully

## Max Iterations

10

## Context Files

- CLAUDE.md - Main project instructions
- README.md - Setup guide
- apps/api/src/server.ts - API entry point
- apps/worker/src/worker.ts - Worker entry point
- packages/ - Shared packages
- infra/docker-compose.yml - Infrastructure

## Notes

GitHub App is the most complex component with split architecture (API + Worker).

When making changes:
- Test with real GitHub webhooks (use ngrok)
- Verify webhook signature validation
- Test job deduplication
- Monitor Redis queue health
- Check Check Run output on actual PRs
