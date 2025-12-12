// tests/setup-env.ts
import { vi } from 'vitest';

// Set NODE_ENV to 'test' before any other code runs
process.env.NODE_ENV = 'test';

// Provide dummy values for environment variables that are checked at the module level.
// This prevents warnings about missing variables during test runs.
process.env.APP_ID = '12345';
process.env.APP_PRIVATE_KEY_PEM_BASE64 = Buffer.from('test-private-key').toString('base64');
process.env.WEBHOOK_SECRET = 'test-secret';

// Mock the logger to suppress output during tests.
// This mock needs to cover all exports from the logger module.
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger), // Return the same mock for child loggers
};

vi.mock('../packages/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
  createCorrelatedLogger: vi.fn(() => mockLogger),
}));
