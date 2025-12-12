import { describe, it, expect } from 'vitest';
import openapiSpec from '../apps/api/src/openapi.json';

describe('OpenAPI Specification', () => {
  it('should have valid OpenAPI 3.1.0 structure', () => {
    expect(openapiSpec.openapi).toBe('3.1.0');
    expect(openapiSpec.info).toBeDefined();
    expect(openapiSpec.info.title).toBe('FlowLint API');
    expect(openapiSpec.info.version).toBeDefined();
    expect(openapiSpec.paths).toBeDefined();
  });

  it('should document the webhook endpoint', () => {
    expect(openapiSpec.paths['/webhooks/github']).toBeDefined();
    const webhookPath = openapiSpec.paths['/webhooks/github'];
    expect(webhookPath.post).toBeDefined();
    expect(webhookPath.post.summary).toBe('GitHub Webhook Receiver');
  });

  it('should define webhook request parameters', () => {
    const webhookPost = openapiSpec.paths['/webhooks/github'].post;
    expect(webhookPost.parameters).toBeDefined();
    
    const eventHeader = webhookPost.parameters.find((p: any) => p.name === 'X-GitHub-Event');
    expect(eventHeader).toBeDefined();
    expect(eventHeader?.required).toBe(true);
    
    const deliveryHeader = webhookPost.parameters.find((p: any) => p.name === 'X-GitHub-Delivery');
    expect(deliveryHeader).toBeDefined();
    expect(deliveryHeader?.required).toBe(true);
    
    const signatureHeader = webhookPost.parameters.find((p: any) => p.name === 'X-Hub-Signature-256');
    expect(signatureHeader).toBeDefined();
    expect(signatureHeader?.required).toBe(true);
  });

  it('should define webhook request body schemas', () => {
    const webhookPost = openapiSpec.paths['/webhooks/github'].post;
    expect(webhookPost.requestBody).toBeDefined();
    expect(webhookPost.requestBody.content['application/json']).toBeDefined();
    expect(webhookPost.requestBody.content['application/json'].schema).toBeDefined();
  });

  it('should define webhook response schemas', () => {
    const webhookPost = openapiSpec.paths['/webhooks/github'].post;
    expect(webhookPost.responses['200']).toBeDefined();
    expect(webhookPost.responses['202']).toBeDefined();
    expect(webhookPost.responses['401']).toBeDefined();
    expect(webhookPost.responses['429']).toBeDefined();
  });

  it('should document health check endpoints', () => {
    expect(openapiSpec.paths['/healthz']).toBeDefined();
    expect(openapiSpec.paths['/livez']).toBeDefined();
    expect(openapiSpec.paths['/readyz']).toBeDefined();
    
    expect(openapiSpec.paths['/healthz'].get).toBeDefined();
    expect(openapiSpec.paths['/livez'].get).toBeDefined();
    expect(openapiSpec.paths['/readyz'].get).toBeDefined();
  });

  it('should document metrics endpoint', () => {
    expect(openapiSpec.paths['/metrics']).toBeDefined();
    expect(openapiSpec.paths['/metrics'].get).toBeDefined();
    expect(openapiSpec.paths['/metrics'].get.summary).toBe('Prometheus Metrics');
  });

  it('should define component schemas', () => {
    expect(openapiSpec.components).toBeDefined();
    expect(openapiSpec.components.schemas).toBeDefined();
    
    expect(openapiSpec.components.schemas.PullRequestEvent).toBeDefined();
    expect(openapiSpec.components.schemas.CheckSuiteEvent).toBeDefined();
    expect(openapiSpec.components.schemas.CheckRunEvent).toBeDefined();
    expect(openapiSpec.components.schemas.InstallationRepositoriesEvent).toBeDefined();
    
    expect(openapiSpec.components.schemas.WebhookSuccess).toBeDefined();
    expect(openapiSpec.components.schemas.WebhookError).toBeDefined();
    expect(openapiSpec.components.schemas.HealthResponse).toBeDefined();
    expect(openapiSpec.components.schemas.LivenessResponse).toBeDefined();
  });

  it('should define security schemes', () => {
    expect(openapiSpec.components.securitySchemes).toBeDefined();
    expect(openapiSpec.components.securitySchemes.GitHubWebhookSignature).toBeDefined();
    expect(openapiSpec.components.securitySchemes.GitHubWebhookSignature.type).toBe('apiKey');
    expect(openapiSpec.components.securitySchemes.GitHubWebhookSignature.in).toBe('header');
    expect(openapiSpec.components.securitySchemes.GitHubWebhookSignature.name).toBe('X-Hub-Signature-256');
  });

  it('should include server configurations', () => {
    expect(openapiSpec.servers).toBeDefined();
    expect(openapiSpec.servers.length).toBeGreaterThan(0);
    
    const productionServer = openapiSpec.servers.find((s: any) => s.description === 'Production server');
    expect(productionServer).toBeDefined();
    
    const devServer = openapiSpec.servers.find((s: any) => s.description === 'Development server');
    expect(devServer).toBeDefined();
  });

  it('should include tags for organization', () => {
    expect(openapiSpec.tags).toBeDefined();
    expect(openapiSpec.tags.length).toBeGreaterThan(0);
    
    const tags = openapiSpec.tags.map((t: any) => t.name);
    expect(tags).toContain('Webhooks');
    expect(tags).toContain('Health');
    expect(tags).toContain('Metrics');
  });

  it('should have webhook examples', () => {
    const webhookPost = openapiSpec.paths['/webhooks/github'].post;
    const examples = webhookPost.requestBody.content['application/json'].examples;
    
    expect(examples).toBeDefined();
    expect(examples.pull_request_opened).toBeDefined();
    expect(examples.check_suite_requested).toBeDefined();
  });

  it('should define rate limit headers in 429 response', () => {
    const webhookPost = openapiSpec.paths['/webhooks/github'].post;
    const rateLimitResponse = webhookPost.responses['429'];
    
    expect(rateLimitResponse.headers).toBeDefined();
    expect(rateLimitResponse.headers['RateLimit-Limit']).toBeDefined();
    expect(rateLimitResponse.headers['RateLimit-Remaining']).toBeDefined();
    expect(rateLimitResponse.headers['RateLimit-Reset']).toBeDefined();
  });

  it('should validate PullRequestEvent schema structure', () => {
    const prEventSchema = openapiSpec.components.schemas.PullRequestEvent;
    
    expect(prEventSchema.type).toBe('object');
    expect(prEventSchema.required).toContain('action');
    expect(prEventSchema.required).toContain('pull_request');
    expect(prEventSchema.required).toContain('repository');
    expect(prEventSchema.required).toContain('installation');
    
    expect(prEventSchema.properties.action).toBeDefined();
    expect(prEventSchema.properties.action.enum).toContain('opened');
    expect(prEventSchema.properties.action.enum).toContain('synchronize');
    expect(prEventSchema.properties.action.enum).toContain('ready_for_review');
  });

  it('should validate CheckSuiteEvent schema structure', () => {
    const checkSuiteSchema = openapiSpec.components.schemas.CheckSuiteEvent;
    
    expect(checkSuiteSchema.type).toBe('object');
    expect(checkSuiteSchema.required).toContain('action');
    expect(checkSuiteSchema.required).toContain('check_suite');
    expect(checkSuiteSchema.required).toContain('repository');
    expect(checkSuiteSchema.required).toContain('installation');
    
    expect(checkSuiteSchema.properties.action.enum).toContain('requested');
    expect(checkSuiteSchema.properties.action.enum).toContain('rerequested');
  });

  it('should validate HealthResponse schema structure', () => {
    const healthSchema = openapiSpec.components.schemas.HealthResponse;
    
    expect(healthSchema.type).toBe('object');
    expect(healthSchema.required).toContain('status');
    expect(healthSchema.required).toContain('timestamp');
    expect(healthSchema.required).toContain('checks');
    
    expect(healthSchema.properties.status.enum).toContain('ok');
    expect(healthSchema.properties.status.enum).toContain('degraded');
    expect(healthSchema.properties.status.enum).toContain('error');
  });
});
