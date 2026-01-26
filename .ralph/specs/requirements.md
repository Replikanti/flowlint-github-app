# FlowLint GitHub App - Technical Requirements

## Overview

GitHub App for automated PR-based linting. Split architecture with API server and Worker pool.

## Core Functionality

### API Server
- GitHub webhook receiver (pull_request events)
- HMAC signature validation (security critical)
- Job enqueuing to BullMQ/Redis
- Rate limiting (per installation)
- Health check endpoint
- Metrics endpoint (Prometheus)

### Worker
- Job polling from BullMQ/Redis
- GitHub API integration (Octokit)
- File fetching from PRs
- Linting via flowlint-core
- Check Run creation with annotations
- Retry logic with exponential backoff

### Job Processing
- Job deduplication via ID: `{owner}/{repo}#{pr}@{sha}`
- Idempotent processing
- At-least-once delivery guarantee
- Configurable retry (2s base, 3 attempts)
- Dead letter queue for failures

## GitHub Integration

### Webhooks
- pull_request (opened, synchronize, reopened)
- HMAC-SHA256 signature validation
- 202 Accepted response (async processing)

### Check Runs API
- Create check run on PR commit
- Report status (queued → in_progress → completed)
- Add annotations for findings
- Link to documentation URLs
- Summary with statistics

### Permissions Required
- Contents: read (fetch files)
- Pull requests: read (PR metadata)
- Checks: write (post Check Runs)

## Infrastructure

### Docker Compose
- API service (port 8080)
- Worker service (horizontally scalable)
- Redis service (persistence enabled)
- Volume mounts for logs

### Scalability
- Stateless API (can run multiple instances)
- Worker pool (scale via replicas)
- Redis as queue and state store

### Observability
- Structured logging (Pino, JSON format)
- Metrics (Prometheus format)
- Distributed tracing (OpenTelemetry)
- Correlation IDs across services

## Technical Constraints

- Node.js >= 24.12.0
- Depends on `@replikanti/flowlint-core`
- Redis >= 6.0
- GitHub App credentials required
- Docker for deployment

## Security

- Webhook signature validation (HMAC-SHA256)
- GitHub App private key security
- No secrets in logs (redaction)
- Rate limiting per installation
- Input validation on all webhook payloads

## Performance

- Async webhook processing (202 response)
- Parallel file processing
- Efficient GitHub API usage (minimize calls)
- Queue-based backpressure handling
- Worker autoscaling support

## Error Handling

- Graceful degradation (partial results)
- Exponential backoff for retries
- GitHub API error mapping
- Structured error logging
- Dead letter queue for repeated failures
