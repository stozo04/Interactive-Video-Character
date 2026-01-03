import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomFromArray, shuffleArray } from '../arrayUtils';

describe('arrayUtils', () => {
  describe('randomFromArray', () => {
    it('should return an item from the array', () => {
      const items = ['a', 'b', 'c'];
      const result = randomFromArray(items);
      expect(items).toContain(result);
    });

    it('should return the only item from single-item array', () => {
      expect(randomFromArray(['only'])).toBe('only');
    });

    it('should throw error for empty array', () => {
      expect(() => randomFromArray([])).toThrow('Cannot select a random item from an empty array.');
    });

    it('should work with different types', () => {
      const numbers = [1, 2, 3];
      const result = randomFromArray(numbers);
      expect(numbers).toContain(result);

      const objects = [{ id: 1 }, { id: 2 }];
      const objResult = randomFromArray(objects);
      expect(objects).toContain(objResult);
    });

    describe('with mocked Math.random', () => {
      beforeEach(() => {
        vi.spyOn(Math, 'random');
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('should return first item when Math.random returns 0', () => {
        vi.mocked(Math.random).mockReturnValue(0);
        expect(randomFromArray(['a', 'b', 'c'])).toBe('a');
      });

      it('should return last item when Math.random returns 0.99', () => {
        vi.mocked(Math.random).mockReturnValue(0.99);
        expect(randomFromArray(['a', 'b', 'c'])).toBe('c');
      });
    });
  });

  describe('shuffleArray', () => {
    it('should return array with same length', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result).toHaveLength(input.length);
    });

    it('should contain all original elements', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result.sort()).toEqual(input.sort());
    });

    it('should not mutate the original array', () => {
      const input = [1, 2, 3, 4, 5];
      const inputCopy = [...input];
      shuffleArray(input);
      expect(input).toEqual(inputCopy);
    });

    it('should return empty array for empty input', () => {
      expect(shuffleArray([])).toEqual([]);
    });

    it('should return same element for single-item array', () => {
      expect(shuffleArray(['only'])).toEqual(['only']);
    });

    it('should work with different types', () => {
      const strings = ['a', 'b', 'c'];
      const shuffled = shuffleArray(strings);
      expect(shuffled).toHaveLength(3);
      expect(shuffled.sort()).toEqual(['a', 'b', 'c']);
    });

    describe('with mocked Math.random', () => {
      beforeEach(() => {
        vi.spyOn(Math, 'random');
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('should produce deterministic output with fixed random values', () => {
        // Mock to always return 0, which means always swap with index 0
        vi.mocked(Math.random).mockReturnValue(0);
        const result = shuffleArray([1, 2, 3]);
        // With always returning 0, the algorithm produces a specific pattern
        expect(result).toEqual([2, 3, 1]);
      });
    });
  });
});
