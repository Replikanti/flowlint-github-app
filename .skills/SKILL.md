# FlowLint GitHub App Development Skill

## Metadata
- **Name:** flowlint-github-app-dev
- **License:** MIT
- **Compatibility:** Claude Code, Node.js 24+, Docker

## Description

FlowLint GitHub App provides automated PR-based linting for n8n workflows via GitHub Check Runs. Uses split architecture: API server for webhooks and Worker for job processing with BullMQ queue.

Depends on `@replikanti/flowlint-core` for parsing and rule execution.

## Capabilities

- **webhook-handler:** Modify webhook processing logic
- **worker-job:** Add/modify worker job types
- **check-run:** Customize Check Run output format
- **scaling:** Horizontal scaling configuration
- **observability:** Add metrics, logging, tracing
- **fix-bug:** Fix API or worker bugs

## Project Structure

```
flowlint-github-app/
├── apps/
│   ├── api/             # Express webhook handler
│   │   └── src/
│   │       └── server.ts
│   └── worker/          # BullMQ job processor
│       └── src/
│           └── worker.ts
├── packages/
│   ├── github/          # Octokit utilities
│   ├── logger/          # Pino logging
│   ├── observability/   # Prometheus metrics
│   └── tracing/         # OpenTelemetry
├── infra/
│   └── docker-compose.yml
└── tests/               # Integration tests
```

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm test` | Run all tests |
| `npm run dev:api` | Start API server |
| `npm run dev:worker` | Start worker |
| `npm run build` | TypeScript compilation |

## Architecture

### API Server (apps/api)
- Receives GitHub webhooks (pull_request events)
- Validates HMAC signatures
- Enqueues jobs to BullMQ/Redis
- Returns 202 Accepted immediately

### Worker (apps/worker)
- Polls Redis queue for jobs
- Fetches changed files from GitHub API
- Runs flowlint-core analysis
- Posts Check Runs with annotations
- Handles retries and failures

### Job Flow
1. GitHub sends PR webhook → API
2. API validates signature → enqueues job
3. Worker polls queue → processes job
4. Worker fetches files → runs linting
5. Worker posts Check Run → GitHub

### Job Deduplication
- Job ID format: `{owner}/{repo}#{pr}@{sha}`
- Prevents duplicate processing of same commit

## Infrastructure

### Docker Compose
- API container (port 8080)
- Worker container (N replicas)
- Redis container (persistence enabled)

### Environment Variables
```bash
# GitHub App
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=

# Redis
REDIS_URL=redis://localhost:6379

# Observability
LOG_LEVEL=info
PROMETHEUS_PORT=9090
```

## Common Tasks

### Add New Job Type

1. Define job type in `packages/github/types.ts`
2. Add handler in `apps/worker/src/handlers/`
3. Enqueue in `apps/api/src/webhooks/`
4. Add tests
5. Update documentation

### Modify Check Run Output

1. Edit `apps/worker/src/github-output.ts`
2. Test with sample findings
3. Verify on actual PR
4. Update tests

### Scale Workers

```bash
# Edit docker-compose.yml
docker-compose up --scale worker=3
```

### Add Metrics

1. Define metric in `packages/observability/`
2. Instrument code (API or worker)
3. Verify in Prometheus
4. Create Grafana dashboard

## Observability

### Logging (Pino)
- Structured JSON logs
- Correlation IDs for request tracing
- Sensitive data redaction

### Metrics (Prometheus)
- API: request rate, latency, errors
- Worker: job processing time, queue depth
- Business: findings per PR, rule violations

### Tracing (OpenTelemetry)
- Distributed tracing across API → Worker
- Span instrumentation
- Jaeger/Zipkin export

## Guardrails

- Never commit to main branch
- Always run `npm test` before committing
- Test webhooks with ngrok or similar
- Follow Conventional Commits: `type(scope): description`
- Use internal scope names (api, worker, github-client) not repo name
- Validate webhook signatures (security critical)
- Handle GitHub API rate limits gracefully
- Job deduplication is critical for correctness

## Related Files

- `CLAUDE.md` - Main project instructions
- `README.md` - Setup and deployment guide
- `.env.example` - Environment variable template
- `infra/docker-compose.yml` - Infrastructure definition
- `../flowlint-core/` - Core library dependency
