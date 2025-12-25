import { describe, it, expect } from 'vitest';
import { assertCheckRunId, formatParseError } from '../../apps/worker/src/review-processor';
import { ValidationError } from '@replikanti/flowlint-core';

describe('Worker Helpers', () => {
  describe('assertCheckRunId', () => {
    it('should return id if defined', () => {
      expect(assertCheckRunId(123)).toBe(123);
    });

    it('should throw if undefined', () => {
      expect(() => assertCheckRunId(undefined)).toThrow('FlowLint check run was not initialized');
    });
  });

  describe('formatParseError', () => {
    it('should format ValidationError', () => {
      const err = new ValidationError('Validation failed');
      err.errors = [{ path: 'node.id', message: 'Missing ID', suggestion: 'Add ID' }];
      
      const formatted = formatParseError(err);
      expect(formatted).toContain('- node.id: Missing ID (suggestion: Add ID)');
    });

    it('should format generic Error', () => {
      const err = new Error('Boom');
      expect(formatParseError(err)).toContain('Error: Boom');
    });

    it('should return undefined for unknown types', () => {
      expect(formatParseError('string')).toBeUndefined();
    });
  });
});
