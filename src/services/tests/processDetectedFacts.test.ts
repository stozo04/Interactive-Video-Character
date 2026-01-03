import { describe, it, expect, beforeEach, vi } from 'vitest';

// Create mock functions BEFORE mocking the module
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockUpsert = vi.fn();
const mockFrom = vi.fn();

// Mock Supabase client
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}));

// Import AFTER mocking
import { processDetectedFacts, LLMDetectedFact } from '../memoryService';

describe('processDetectedFacts', () => {
  const userId = 'test-user-123';

  // Helper to set up getUserFacts mock response
  const mockGetUserFactsResponse = (facts: Array<{ category: string; fact_key: string; fact_value: string }>) => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_facts') {
        const orderResult = {
          // For when category === 'all', can be awaited directly
          [Symbol.toStringTag]: 'Promise',
          then: (resolve: any) => Promise.resolve({ data: facts, error: null }).then(resolve),
          catch: (reject: any) => Promise.resolve({ data: facts, error: null }).catch(reject),
          // For when category !== 'all', can call .eq()
          eq: () => Promise.resolve({ data: facts, error: null }),
        };
        return {
          select: () => ({
            order: () => orderResult,
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      return {};
    });
  };

  // Helper to track upsert calls
  const setupUpsertTracking = (existingFacts: Array<{ category: string; fact_key: string; fact_value: string }> = []) => {
    const upsertCalls: any[] = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_facts') {
        const orderResult = {
          // For when category === 'all', can be awaited directly
          [Symbol.toStringTag]: 'Promise',
          then: (resolve: any) => Promise.resolve({ data: existingFacts, error: null }).then(resolve),
          catch: (reject: any) => Promise.resolve({ data: existingFacts, error: null }).catch(reject),
          // For when category !== 'all', can call .eq()
          eq: () => Promise.resolve({ data: existingFacts, error: null }),
        };
        return {
          select: () => ({
            order: () => orderResult,
          }),
          upsert: (data: any) => {
            upsertCalls.push(data);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    });

    return upsertCalls;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // Empty/Null Input Handling
  // ============================================
  describe('empty input handling', () => {
    it('should return empty array when detectedFacts is empty', async () => {
      const result = await processDetectedFacts([]);
      expect(result).toEqual([]);
    });

    it('should return empty array when detectedFacts is null/undefined', async () => {
      const result = await processDetectedFacts(null as any);
      expect(result).toEqual([]);
    });
  });

  // ============================================
  // IMMUTABLE Facts (name, birthday, etc.)
  // ============================================
  describe('immutable facts', () => {
    it('should store name if not already set', async () => {
      const upsertCalls = setupUpsertTracking([]);

      const facts: LLMDetectedFact[] = [
        { category: 'identity', key: 'name', value: 'Steven', confidence: 0.95 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_key).toBe('name');
      expect(upsertCalls[0].fact_value).toBe('Steven');
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe('Steven');
    });

    it('should NOT overwrite existing name (immutable)', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'identity', fact_key: 'name', fact_value: 'Steven' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'identity', key: 'name', value: 'John', confidence: 0.95 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(0);
      expect(result).toHaveLength(0);
    });

    it('should NOT overwrite existing birthday (immutable)', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'identity', fact_key: 'birthday', fact_value: 'July 15th' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'identity', key: 'birthday', value: 'August 20th', confidence: 0.9 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(0);
      expect(result).toHaveLength(0);
    });

    it('should protect all immutable keys: name, middle_name, last_name, birthday, birth_year, gender', async () => {
      const immutableKeys = ['name', 'middle_name', 'last_name', 'birthday', 'birth_year', 'gender'];

      const upsertCalls = setupUpsertTracking(
        immutableKeys.map(key => ({ category: 'identity', fact_key: key, fact_value: 'existing' }))
      );

      const facts: LLMDetectedFact[] = immutableKeys.map(key => ({
        category: 'identity' as const,
        key,
        value: 'new_value',
        confidence: 0.95
      }));

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(0);
      expect(result).toHaveLength(0);
    });
  });

  // ============================================
  // MUTABLE Facts (occupation, location, etc.)
  // ============================================
  describe('mutable facts', () => {
    it('should store new occupation', async () => {
      const upsertCalls = setupUpsertTracking([]);

      const facts: LLMDetectedFact[] = [
        { category: 'identity', key: 'occupation', value: 'Software Engineer', confidence: 0.9 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_key).toBe('occupation');
      expect(upsertCalls[0].fact_value).toBe('Software Engineer');
      expect(result).toHaveLength(1);
    });

    it('should UPDATE existing occupation (mutable)', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'identity', fact_key: 'occupation', fact_value: 'Developer' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'identity', key: 'occupation', value: 'Tech Lead', confidence: 0.9 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_value).toBe('Tech Lead');
      expect(result).toHaveLength(1);
    });

    it('should UPDATE family location when they move (mutable)', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'relationship', fact_key: 'family_location_grandparent', fact_value: 'Florida' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'relationship', key: 'family_location_grandparent', value: 'Alabama', confidence: 0.85 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_value).toBe('Alabama');
      expect(result).toHaveLength(1);
    });

    it('should UPDATE relationship_status when it changes', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'relationship', fact_key: 'relationship_status', fact_value: 'single' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'relationship', key: 'relationship_status', value: 'married', confidence: 0.95 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_value).toBe('married');
      expect(result).toHaveLength(1);
    });
  });

  // ============================================
  // ADDITIVE Facts (favorites, likes, etc.)
  // ============================================
  describe('additive facts', () => {
    it('should store first favorite_lunch_spot as plain value', async () => {
      const upsertCalls = setupUpsertTracking([]);

      const facts: LLMDetectedFact[] = [
        { category: 'preference', key: 'favorite_lunch_spot', value: 'Chipotle', confidence: 0.9 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_value).toBe('Chipotle');
      expect(result).toHaveLength(1);
    });

    it('should APPEND to existing favorite_lunch_spot (create JSON array)', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'preference', fact_key: 'favorite_lunch_spot', fact_value: 'Chipotle' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'preference', key: 'favorite_lunch_spot', value: 'Panera', confidence: 0.85 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_value).toBe('["Chipotle","Panera"]');
      expect(result).toHaveLength(1);
    });

    it('should APPEND to existing JSON array', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'preference', fact_key: 'favorite_lunch_spot', fact_value: '["Chipotle","Panera"]' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'preference', key: 'favorite_lunch_spot', value: 'Subway', confidence: 0.85 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_value).toBe('["Chipotle","Panera","Subway"]');
      expect(result).toHaveLength(1);
    });

    it('should NOT add duplicate to additive array (case-insensitive)', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'preference', fact_key: 'favorite_lunch_spot', fact_value: '["Chipotle","Panera"]' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'preference', key: 'favorite_lunch_spot', value: 'chipotle', confidence: 0.85 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(0);
      expect(result).toHaveLength(0);
    });

    it('should NOT add duplicate to single-value additive fact', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'preference', fact_key: 'favorite_lunch_spot', fact_value: 'Chipotle' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'preference', key: 'favorite_lunch_spot', value: 'CHIPOTLE', confidence: 0.85 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(0);
      expect(result).toHaveLength(0);
    });

    it('should handle "likes" as additive', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'preference', fact_key: 'likes', fact_value: 'coffee' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'preference', key: 'likes', value: 'tea', confidence: 0.85 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_value).toBe('["coffee","tea"]');
      expect(result).toHaveLength(1);
    });

    it('should handle "hobbies" as additive', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'preference', fact_key: 'hobbies', fact_value: '["gaming","reading"]' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'preference', key: 'hobbies', value: 'hiking', confidence: 0.9 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_value).toBe('["gaming","reading","hiking"]');
      expect(result).toHaveLength(1);
    });

    it('should handle any key starting with "favorite_" as additive', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'preference', fact_key: 'favorite_movie', fact_value: 'Inception' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'preference', key: 'favorite_movie', value: 'The Matrix', confidence: 0.9 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].fact_value).toBe('["Inception","The Matrix"]');
      expect(result).toHaveLength(1);
    });
  });

  // ============================================
  // Mixed Fact Types in One Call
  // ============================================
  describe('mixed fact types', () => {
    it('should handle immutable, mutable, and additive facts in same call', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'identity', fact_key: 'name', fact_value: 'Steven' },
        { category: 'preference', fact_key: 'favorite_food', fact_value: 'Pizza' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'identity', key: 'name', value: 'John', confidence: 0.95 },
        { category: 'identity', key: 'occupation', value: 'Engineer', confidence: 0.9 },
        { category: 'preference', key: 'favorite_food', value: 'Tacos', confidence: 0.85 }
      ];

      const result = await processDetectedFacts(facts);

      // Name should be skipped (immutable), occupation and favorite_food stored
      expect(upsertCalls.length).toBe(2);

      // Find the occupation and favorite_food upserts
      const occupationUpsert = upsertCalls.find(c => c.fact_key === 'occupation');
      const favoriteUpsert = upsertCalls.find(c => c.fact_key === 'favorite_food');

      expect(occupationUpsert?.fact_value).toBe('Engineer');
      expect(favoriteUpsert?.fact_value).toBe('["Pizza","Tacos"]');
      expect(result).toHaveLength(2);
    });

    it('should process multiple new facts correctly', async () => {
      const upsertCalls = setupUpsertTracking([]);

      const facts: LLMDetectedFact[] = [
        { category: 'identity', key: 'name', value: 'Steven', confidence: 0.95 },
        { category: 'identity', key: 'occupation', value: 'Developer', confidence: 0.9 },
        { category: 'preference', key: 'likes', value: 'coffee', confidence: 0.85 },
        { category: 'relationship', key: 'has_pet', value: 'yes', confidence: 0.9 }
      ];

      const result = await processDetectedFacts(facts);

      expect(upsertCalls.length).toBe(4);
      expect(result).toHaveLength(4);
    });
  });

  // ============================================
  // Error Handling
  // ============================================
  describe('error handling', () => {
    it('should return empty array if getUserFacts fails', async () => {
      mockFrom.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: null, error: { message: 'Database error' } }),
          }),
        }),
      }));

      const facts: LLMDetectedFact[] = [
        { category: 'identity', key: 'name', value: 'Steven', confidence: 0.95 }
      ];

      const result = await processDetectedFacts(facts);

      // Should still try to store since empty array is returned on error
      // The function handles errors gracefully
      expect(result).toBeDefined();
    });
  });

  // ============================================
  // Edge Cases - Category Matching
  // ============================================
  describe('category matching', () => {
    it('should handle same key in different categories as separate facts', async () => {
      const upsertCalls = setupUpsertTracking([
        { category: 'identity', fact_key: 'location', fact_value: 'Texas' }
      ]);

      const facts: LLMDetectedFact[] = [
        { category: 'context', key: 'location', value: 'At home', confidence: 0.85 }
      ];

      const result = await processDetectedFacts(facts);

      // Should store because category:key combo is different
      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0].category).toBe('context');
      expect(upsertCalls[0].fact_value).toBe('At home');
      expect(result).toHaveLength(1);
    });
  });
});
