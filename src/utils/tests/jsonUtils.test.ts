import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '../jsonUtils';

describe('jsonUtils', () => {
  describe('extractJsonObject', () => {
    it('should extract a simple JSON object', () => {
      const input = '{"key": "value"}';
      expect(extractJsonObject(input)).toBe('{"key": "value"}');
    });

    it('should extract JSON from text with prefix', () => {
      const input = 'Some text before {"key": "value"}';
      expect(extractJsonObject(input)).toBe('{"key": "value"}');
    });

    it('should extract JSON from text with suffix', () => {
      const input = '{"key": "value"} some text after';
      expect(extractJsonObject(input)).toBe('{"key": "value"}');
    });

    it('should extract JSON from text with both prefix and suffix', () => {
      const input = 'prefix {"key": "value"} suffix';
      expect(extractJsonObject(input)).toBe('{"key": "value"}');
    });

    it('should handle nested objects', () => {
      const input = '{"outer": {"inner": "value"}}';
      expect(extractJsonObject(input)).toBe('{"outer": {"inner": "value"}}');
    });

    it('should handle deeply nested objects', () => {
      const input = '{"a": {"b": {"c": {"d": "deep"}}}}';
      expect(extractJsonObject(input)).toBe('{"a": {"b": {"c": {"d": "deep"}}}}');
    });

    it('should handle strings containing braces', () => {
      const input = '{"text": "hello { world }"}';
      expect(extractJsonObject(input)).toBe('{"text": "hello { world }"}');
    });

    it('should handle escaped quotes in strings', () => {
      const input = '{"text": "say \\"hello\\""}';
      expect(extractJsonObject(input)).toBe('{"text": "say \\"hello\\""}');
    });

    it('should handle arrays in objects', () => {
      const input = '{"items": [1, 2, 3]}';
      expect(extractJsonObject(input)).toBe('{"items": [1, 2, 3]}');
    });

    it('should return null for string without braces', () => {
      expect(extractJsonObject('no json here')).toBe(null);
    });

    it('should return null for empty string', () => {
      expect(extractJsonObject('')).toBe(null);
    });

    it('should handle markdown code blocks around JSON', () => {
      const input = '```json\n{"key": "value"}\n```';
      expect(extractJsonObject(input)).toBe('{"key": "value"}');
    });

    it('should extract first complete object when multiple exist', () => {
      const input = '{"first": 1} {"second": 2}';
      expect(extractJsonObject(input)).toBe('{"first": 1}');
    });

    it('should handle boolean and number values', () => {
      const input = '{"active": true, "count": 42}';
      expect(extractJsonObject(input)).toBe('{"active": true, "count": 42}');
    });

    it('should handle null values', () => {
      const input = '{"value": null}';
      expect(extractJsonObject(input)).toBe('{"value": null}');
    });
  });
});
