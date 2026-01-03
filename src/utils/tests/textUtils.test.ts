import { describe, it, expect } from 'vitest';
import { sanitizeText, isQuestionMessage, QUESTION_STARTERS } from '../textUtils';

describe('textUtils', () => {
  describe('sanitizeText', () => {
    it('should lowercase text', () => {
      expect(sanitizeText('Hello World')).toBe('hello world');
    });

    it('should remove special characters', () => {
      expect(sanitizeText('Hello, World!')).toBe('hello world');
    });

    it('should normalize multiple spaces', () => {
      expect(sanitizeText('hello    world')).toBe('hello world');
    });

    it('should trim whitespace', () => {
      expect(sanitizeText('  hello world  ')).toBe('hello world');
    });

    it('should keep numbers', () => {
      expect(sanitizeText('Test123')).toBe('test123');
    });

    it('should handle empty string', () => {
      expect(sanitizeText('')).toBe('');
    });

    it('should handle string with only special characters', () => {
      expect(sanitizeText('!@#$%')).toBe('');
    });
  });

  describe('QUESTION_STARTERS', () => {
    it('should include common question words', () => {
      expect(QUESTION_STARTERS).toContain('what');
      expect(QUESTION_STARTERS).toContain('who');
      expect(QUESTION_STARTERS).toContain('where');
      expect(QUESTION_STARTERS).toContain('when');
      expect(QUESTION_STARTERS).toContain('why');
      expect(QUESTION_STARTERS).toContain('how');
    });

    it('should include auxiliary verbs used in questions', () => {
      expect(QUESTION_STARTERS).toContain('do');
      expect(QUESTION_STARTERS).toContain('does');
      expect(QUESTION_STARTERS).toContain('can');
      expect(QUESTION_STARTERS).toContain('is');
      expect(QUESTION_STARTERS).toContain('are');
    });
  });

  describe('isQuestionMessage', () => {
    it('should return true for messages ending with ?', () => {
      expect(isQuestionMessage('Is this working?')).toBe(true);
      expect(isQuestionMessage('Hello?')).toBe(true);
    });

    it('should return true for messages starting with question words', () => {
      expect(isQuestionMessage('What is your name')).toBe(true);
      expect(isQuestionMessage('How are you doing')).toBe(true);
      expect(isQuestionMessage('Where is the meeting')).toBe(true);
    });

    it('should return true for messages starting with auxiliary verbs', () => {
      expect(isQuestionMessage('Do you like pizza')).toBe(true);
      expect(isQuestionMessage('Can you help me')).toBe(true);
      expect(isQuestionMessage('Is it ready')).toBe(true);
    });

    it('should return false for statements', () => {
      expect(isQuestionMessage('I like pizza')).toBe(false);
      expect(isQuestionMessage('This is great')).toBe(false);
      expect(isQuestionMessage('Hello there')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isQuestionMessage('')).toBe(false);
    });

    it('should return false for whitespace only', () => {
      expect(isQuestionMessage('   ')).toBe(false);
    });

    it('should handle messages with special characters', () => {
      expect(isQuestionMessage('What!!! is happening')).toBe(true);
      expect(isQuestionMessage('...how are you')).toBe(true);
    });
  });
});
