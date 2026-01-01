# FlowLint GitHub App

![Coverage](https://img.shields.io/badge/coverage-85%25-green)

GitHub App that reviews PRs containing n8n workflow files. When a pull request changes workflow files, FlowLint parses them, applies lint rules, and posts a Check Run with findings.

## Architecture

- **API**: Express webhook handler that receives GitHub webhooks
- **Worker**: BullMQ job processor that runs linting analysis

## Setup

1. Copy `.env.example` to `.env` and configure:
   - `APP_ID`: GitHub App ID
   - `APP_PRIVATE_KEY_PEM_BASE64`: Base64-encoded private key
   - `WEBHOOK_SECRET`: Webhook secret from GitHub App settings

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development servers:
   ```bash
   npm run dev:api
   npm run dev:worker
   ```

## Testing

Run tests with coverage reporting:

```bash
npm run test:coverage
```

## Deployment

Use Docker Compose:

```bash
docker compose -f infra/docker-compose.prod.yml up -d
```

## Integration with @replikanti/flowlint-core

This app uses `@replikanti/flowlint-core` for:
- Parsing n8n workflows
- Running linting rules
- Generating findings

```typescript
import { parseN8n, runAllRules, loadConfig } from '@replikanti/flowlint-core';

const workflow = parseN8n(fileContent);
const findings = runAllRules(workflow, { path: file.path, cfg: config });
```

## License

MIT
