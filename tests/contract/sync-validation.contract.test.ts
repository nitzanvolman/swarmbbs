/**
 * Contract Tests for Sync Validation Error Responses
 *
 * Tests that sync error responses conform to the JSON schema contract
 * and include all required fields with correct structure (T006)
 */

import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { syncConflict } from '../../src/utils/errors.js';
import type { MessageEvent } from '../../src/types/events.js';

describe('Sync Validation - Contract Tests', () => {
  let ajv: Ajv;
  let schema: any;

  beforeAll(async () => {
    // Load the sync error response schema
    const schemaPath = join(process.cwd(), 'specs/002-message-sync-validation/contracts/sync-error-response.schema.json');
    const schemaContent = await readFile(schemaPath, 'utf8');
    schema = JSON.parse(schemaContent);

    // Initialize AJV with formats support
    ajv = new Ajv({ strict: true, allErrors: true });
    addFormats(ajv);
  });

  describe('Sync Error Response Schema Validation', () => {
    it('should validate a sync error response with one missing message', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'I have started working on task A',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      const errorResponse = error.toJSON();

      // Validate against schema
      const validate = ajv.compile(schema);
      const isValid = validate(errorResponse);

      if (!isValid) {
        console.error('Validation errors:', validate.errors);
      }

      expect(isValid).toBe(true);
    });

    it('should validate a sync error response with multiple missing messages', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Message 2',
          up_to_seq: 1,
        },
        {
          type: 'msg',
          seq: 3,
          from: 'agent-c',
          ts: '2025-11-14T10:00:05.000Z',
          text: 'Message 3',
          up_to_seq: 2,
        },
        {
          type: 'msg',
          seq: 4,
          from: 'agent-b',
          ts: '2025-11-14T10:00:10.000Z',
          text: 'Message 4',
          up_to_seq: 3,
        },
      ];

      const error = syncConflict('coordination', missingMessages, {
        last_seq: 4,
        epoch: 0,
      });

      const errorResponse = error.toJSON();

      // Validate against schema
      const validate = ajv.compile(schema);
      const isValid = validate(errorResponse);

      if (!isValid) {
        console.error('Validation errors:', validate.errors);
      }

      expect(isValid).toBe(true);
    });

    it('should validate a sync error response for P2P thread', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 1,
          from: 'agent-b',
          ts: '2025-11-14T09:00:00.000Z',
          text: 'Let\'s coordinate on the FizzBuzz task',
          up_to_seq: 0,
        },
      ];

      const error = syncConflict('p2p/agent-a__agent-b', missingMessages, {
        last_seq: 1,
        epoch: 0,
      });

      const errorResponse = error.toJSON();

      // Validate against schema
      const validate = ajv.compile(schema);
      const isValid = validate(errorResponse);

      if (!isValid) {
        console.error('Validation errors:', validate.errors);
      }

      expect(isValid).toBe(true);
    });

    it('should include all required top-level fields', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      const errorResponse = error.toJSON();

      // Check required fields
      expect(errorResponse).toHaveProperty('error', 'SwarmBBSError');
      expect(errorResponse).toHaveProperty('code', 409);
      expect(errorResponse).toHaveProperty('message');
      expect(errorResponse).toHaveProperty('context');
      expect(errorResponse).toHaveProperty('nextSteps');
    });

    it('should include all required context fields', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      const errorResponse = error.toJSON();

      // Check context structure
      expect(errorResponse.context).toHaveProperty('thread', 'test-thread');
      expect(errorResponse.context).toHaveProperty('missing_messages');
      expect(errorResponse.context).toHaveProperty('cursor_advanced');

      // Check missing_messages is array
      expect(Array.isArray(errorResponse.context.missing_messages)).toBe(true);
      expect(errorResponse.context.missing_messages.length).toBe(1);

      // Check cursor_advanced structure
      expect(errorResponse.context.cursor_advanced).toMatchObject({
        last_seq: 2,
        epoch: 0,
      });
    });

    it('should include complete message metadata in missing_messages', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      const errorResponse = error.toJSON();
      const firstMessage = errorResponse.context.missing_messages[0];

      // Check all required message fields
      expect(firstMessage).toHaveProperty('type', 'msg');
      expect(firstMessage).toHaveProperty('seq', 2);
      expect(firstMessage).toHaveProperty('from', 'agent-b');
      expect(firstMessage).toHaveProperty('ts', '2025-11-14T10:00:00.000Z');
      expect(firstMessage).toHaveProperty('text', 'Test message');
      expect(firstMessage).toHaveProperty('up_to_seq', 1);
    });

    it('should have correct error message text (FR-008)', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      const errorResponse = error.toJSON();

      expect(errorResponse.message).toBe(
        'Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant.'
      );
    });

    it('should have correct nextSteps text', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      const errorResponse = error.toJSON();

      expect(errorResponse.nextSteps).toBe(
        'Review the missing messages and retry your send operation if still appropriate given the new context.'
      );
    });

    it('should reject error response missing required fields', () => {
      const invalidResponse = {
        error: 'SwarmBBSError',
        code: 409,
        // Missing message field
        context: {
          thread: 'test-thread',
          missing_messages: [],
          cursor_advanced: { last_seq: 1, epoch: 0 },
        },
        nextSteps: 'Test',
      };

      const validate = ajv.compile(schema);
      const isValid = validate(invalidResponse);

      expect(isValid).toBe(false);
    });

    it('should reject error response with wrong code', () => {
      const invalidResponse = {
        error: 'SwarmBBSError',
        code: 400, // Wrong code, should be 409
        message: 'Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant.',
        context: {
          thread: 'test-thread',
          missing_messages: [
            {
              type: 'msg',
              seq: 1,
              from: 'agent-b',
              ts: '2025-11-14T10:00:00.000Z',
              text: 'Test',
              up_to_seq: 0,
            },
          ],
          cursor_advanced: { last_seq: 1, epoch: 0 },
        },
        nextSteps: 'Review the missing messages and retry your send operation if still appropriate given the new context.',
      };

      const validate = ajv.compile(schema);
      const isValid = validate(invalidResponse);

      expect(isValid).toBe(false);
    });

    it('should reject error response with empty missing_messages', () => {
      const invalidResponse = {
        error: 'SwarmBBSError',
        code: 409,
        message: 'Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant.',
        context: {
          thread: 'test-thread',
          missing_messages: [], // Should have at least 1 message
          cursor_advanced: { last_seq: 1, epoch: 0 },
        },
        nextSteps: 'Review the missing messages and retry your send operation if still appropriate given the new context.',
      };

      const validate = ajv.compile(schema);
      const isValid = validate(invalidResponse);

      expect(isValid).toBe(false);
    });
  });
});
