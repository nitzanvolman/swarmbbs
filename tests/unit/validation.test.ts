/**
 * Unit Tests for Validation Utilities
 *
 * Tests name validation, text sanitization, and size checking
 */

import { describe, it, expect } from 'vitest';
import {
  validateName,
  assertValidName,
  sanitizeText,
  validateMessageSize,
  validateAnnouncementSize,
  getByteLength,
  canonicalP2PName,
  isP2PThread,
  parseP2PThread,
} from '../../src/utils/validation.js';

describe('Validation Utilities', () => {
  describe('validateName', () => {
    it('should accept valid names', () => {
      expect(validateName('main')).toBe(true);
      expect(validateName('thread-1')).toBe(true);
      expect(validateName('project_v2.0')).toBe(true);
      expect(validateName('space123')).toBe(true);
      expect(validateName('My-Space_2.0')).toBe(true);
    });

    it('should reject names with invalid characters', () => {
      expect(validateName('thread with spaces')).toBe(false);
      expect(validateName('thread/slash')).toBe(false);
      expect(validateName('thread\\backslash')).toBe(false);
      expect(validateName('thread:colon')).toBe(false);
      expect(validateName('thread@at')).toBe(false);
      expect(validateName('thread!exclaim')).toBe(false);
    });

    it('should reject empty names', () => {
      expect(validateName('')).toBe(false);
    });

    it('should reject names with unicode characters', () => {
      expect(validateName('thread-🚀')).toBe(false);
      expect(validateName('スレッド')).toBe(false);
    });
  });

  describe('assertValidName', () => {
    it('should not throw for valid names', () => {
      expect(() => assertValidName('main', 'thread')).not.toThrow();
      expect(() => assertValidName('space-1', 'space')).not.toThrow();
    });

    it('should throw for invalid names', () => {
      expect(() => assertValidName('invalid name', 'thread')).toThrow(
        /Invalid thread name/
      );
      expect(() => assertValidName('bad/slash', 'space')).toThrow(/Invalid space name/);
    });

    it('should include context in error message', () => {
      expect(() => assertValidName('bad name', 'thread')).toThrow(/thread/);
      expect(() => assertValidName('bad name', 'space')).toThrow(/space/);
    });
  });

  describe('sanitizeText', () => {
    it('should replace newlines with spaces', () => {
      const input = 'Line 1\nLine 2\nLine 3';
      const output = sanitizeText(input);
      expect(output).toBe('Line 1 Line 2 Line 3');
    });

    it('should handle CRLF line endings', () => {
      const input = 'Line 1\r\nLine 2\r\nLine 3';
      const output = sanitizeText(input);
      expect(output).toBe('Line 1 Line 2 Line 3');
    });

    it('should trim leading/trailing whitespace', () => {
      const input = '  text with spaces  ';
      const output = sanitizeText(input);
      expect(output).toBe('text with spaces');
    });

    it('should handle multiple consecutive newlines', () => {
      const input = 'Line 1\n\n\nLine 2';
      const output = sanitizeText(input);
      expect(output).toBe('Line 1   Line 2');
    });

    it('should preserve other special characters', () => {
      const input = 'Text with "quotes" and \'apostrophes\' and $symbols$';
      const output = sanitizeText(input);
      expect(output).toBe('Text with "quotes" and \'apostrophes\' and $symbols$');
    });

    it('should handle empty strings', () => {
      expect(sanitizeText('')).toBe('');
      expect(sanitizeText('   ')).toBe('');
    });

    it('should handle text with only newlines', () => {
      expect(sanitizeText('\n\n\n')).toBe('');
    });
  });

  describe('validateMessageSize', () => {
    it('should accept messages under 8 KiB', () => {
      const text = 'a'.repeat(100);
      expect(validateMessageSize(text)).toBe(true);
    });

    it('should accept messages at exactly 8 KiB', () => {
      const text = 'a'.repeat(8192);
      expect(validateMessageSize(text)).toBe(true);
    });

    it('should reject messages over 8 KiB', () => {
      const text = 'a'.repeat(8193);
      expect(validateMessageSize(text)).toBe(false);
    });

    it('should handle multibyte characters correctly', () => {
      // Unicode emoji are typically 4 bytes each
      const text = '🚀'.repeat(2048); // 2048 * 4 = 8192 bytes (exactly 8 KiB)
      expect(validateMessageSize(text)).toBe(true);

      const tooLarge = '🚀'.repeat(2049); // 2049 * 4 = 8196 bytes (over 8 KiB)
      expect(validateMessageSize(tooLarge)).toBe(false);
    });
  });

  describe('validateAnnouncementSize', () => {
    it('should accept announcements under 64 KiB', () => {
      const text = 'a'.repeat(1000);
      expect(validateAnnouncementSize(text)).toBe(true);
    });

    it('should accept announcements at exactly 64 KiB', () => {
      const text = 'a'.repeat(65536);
      expect(validateAnnouncementSize(text)).toBe(true);
    });

    it('should reject announcements over 64 KiB', () => {
      const text = 'a'.repeat(65537);
      expect(validateAnnouncementSize(text)).toBe(false);
    });
  });

  describe('getByteLength', () => {
    it('should return byte length for ASCII text', () => {
      expect(getByteLength('hello')).toBe(5);
      expect(getByteLength('a'.repeat(100))).toBe(100);
    });

    it('should return byte length for multibyte characters', () => {
      expect(getByteLength('🚀')).toBe(4); // Emoji are 4 bytes
      expect(getByteLength('こんにちは')).toBe(15); // Japanese characters are 3 bytes each
    });

    it('should return 0 for empty string', () => {
      expect(getByteLength('')).toBe(0);
    });
  });

  describe('canonicalP2PName', () => {
    it('should create canonical P2P thread name with alphabetical sorting', () => {
      expect(canonicalP2PName('agent-a', 'agent-b')).toBe('p2p/agent-a__agent-b');
      expect(canonicalP2PName('agent-b', 'agent-a')).toBe('p2p/agent-a__agent-b');
    });

    it('should lowercase handles', () => {
      expect(canonicalP2PName('Agent-A', 'Agent-B')).toBe('p2p/agent-a__agent-b');
      expect(canonicalP2PName('ALICE', 'BOB')).toBe('p2p/alice__bob');
    });

    it('should handle same first character', () => {
      expect(canonicalP2PName('alice', 'anna')).toBe('p2p/alice__anna');
      expect(canonicalP2PName('anna', 'alice')).toBe('p2p/alice__anna');
    });

    it('should handle identical handles', () => {
      // Edge case: same agent talking to itself
      expect(canonicalP2PName('agent-a', 'agent-a')).toBe('p2p/agent-a__agent-a');
    });

    it('should handle handles with numbers', () => {
      expect(canonicalP2PName('agent-1', 'agent-2')).toBe('p2p/agent-1__agent-2');
      expect(canonicalP2PName('agent-2', 'agent-1')).toBe('p2p/agent-1__agent-2');
    });
  });

  describe('isP2PThread', () => {
    it('should identify P2P threads', () => {
      expect(isP2PThread('p2p/agent-a__agent-b')).toBe(true);
      expect(isP2PThread('p2p/alice__bob')).toBe(true);
    });

    it('should reject non-P2P threads', () => {
      expect(isP2PThread('main')).toBe(false);
      expect(isP2PThread('alerts')).toBe(false);
      expect(isP2PThread('p2p-but-not-real')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isP2PThread('')).toBe(false);
      expect(isP2PThread('p2p/')).toBe(true); // Starts with p2p/
    });
  });

  describe('parseP2PThread', () => {
    it('should parse valid P2P thread names', () => {
      const result = parseP2PThread('p2p/agent-a__agent-b');
      expect(result).not.toBeNull();
      expect(result!.handleA).toBe('agent-a');
      expect(result!.handleB).toBe('agent-b');
    });

    it('should return null for non-P2P threads', () => {
      expect(parseP2PThread('main')).toBeNull();
      expect(parseP2PThread('alerts')).toBeNull();
    });

    it('should return null for malformed P2P names', () => {
      expect(parseP2PThread('p2p/agent-a')).toBeNull(); // Missing second handle
      expect(parseP2PThread('p2p/agent-a__agent-b__agent-c')).toBeNull(); // Too many handles
      expect(parseP2PThread('p2p/')).toBeNull(); // Empty handles
    });

    it('should handle handles with special characters', () => {
      const result = parseP2PThread('p2p/agent_1__agent-2');
      expect(result).not.toBeNull();
      expect(result!.handleA).toBe('agent_1');
      expect(result!.handleB).toBe('agent-2');
    });
  });

  describe('Text Sanitization - Special Characters', () => {
    it('should preserve unicode characters after sanitization', () => {
      const input = 'Text with emoji 🚀\nNext line 🎉';
      const output = sanitizeText(input);
      expect(output).toContain('🚀');
      expect(output).toContain('🎉');
      expect(output).not.toContain('\n');
    });

    it('should preserve quotes and escapes', () => {
      const input = 'Text with "double quotes" and \'single quotes\'\nNext line';
      const output = sanitizeText(input);
      expect(output).toContain('"double quotes"');
      expect(output).toContain("'single quotes'");
    });

    it('should handle tabs', () => {
      const input = 'Text\twith\ttabs';
      const output = sanitizeText(input);
      expect(output).toBe('Text\twith\ttabs'); // Tabs are preserved
    });

    it('should handle mixed whitespace', () => {
      const input = '  Text  with\n  newlines  and\r\n  spaces  ';
      const output = sanitizeText(input);
      expect(output).toBe('Text  with   newlines  and   spaces');
    });
  });
});
