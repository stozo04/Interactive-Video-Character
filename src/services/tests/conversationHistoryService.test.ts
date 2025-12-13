import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChatMessage } from "@/types";

// --- MOCK SETUP ---
// Create mocks using vi.hoisted() so they're available in the mock factory
const { globalMocks } = vi.hoisted(() => {
  const mocks: any = {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    from: vi.fn(),
  };

  return { globalMocks: mocks };
});

// Mock the supabase client module
vi.mock("../supabaseClient", () => {
  const mocks = globalMocks;

  // Track the resolved value for the next chainable call
  let nextResolvedValue: any = { data: null, error: null };

  // FIX: Helper to create a chainable select/delete builder
  const createChain = (mockFunction: vi.Mock) => {
    // This is the object that has .then/catch and also the chainable methods
    const resolvable: any = {
      then: vi.fn((resolve: any) =>
        Promise.resolve(nextResolvedValue).then(resolve)
      ),
      catch: vi.fn((reject: any) => {
        // Ensure we reject with an error object
        const error = nextResolvedValue?.error || new Error("Mock rejection");
        return Promise.reject(error).catch(reject);
      })
    };

    // Add chainable methods that return the object itself
    resolvable.eq = vi.fn((column: string, value: any) => {
      mocks.eq(column, value);
      return resolvable; // Return self for chaining
    });

    resolvable.order = vi.fn((column: string, options: any) => {
      mocks.order(column, options);
      return resolvable; // Return self
    });
    
    return resolvable; // This object has .eq, .order, .then, .catch
  };

  // Mock implementation for the main .from() call
  const mockFrom = vi.fn((table: string) => ({
    // Select chain: .select().eq().eq().order()
    select: vi.fn((columns: string) => {
        mocks.select(columns);
        return createChain(mocks.select);
    }),
    // Insert chain: .insert()
    insert: vi.fn((rows: any[]) => {
        mocks.insert(rows);
        // Set the value that will be returned by the 'then' mock below
        // We use the last mock return value from mocks.insert to handle chained updates
        nextResolvedValue = mocks.insert.mock.results.pop()?.value || { data: null, error: null };
        return createChain(mocks.insert);
    }),
    // Delete chain: .delete().eq().eq()
    delete: vi.fn()
      .mockImplementation(() => {
        mocks.delete(); // <-- ADD THIS LINE
        return createChain(mocks.delete);
      }),
  }));

  mocks.from = mockFrom;

  const client = {
    from: mockFrom,
    // Add helpers to set the mock resolutions correctly before each test
    setNextResolvedValue: (value: any) => { nextResolvedValue = value; },
    _mocks: mocks,
  } as unknown as SupabaseClient & { setNextResolvedValue: (value: any) => void, _mocks: any };

  return {
    supabase: client,
  };
});

// Import the service after mocking
import {
  saveConversationHistory,
  loadConversationHistory,
  appendConversationHistory,
  clearConversationHistory,
} from "../conversationHistoryService";

// Import the mocked supabase client for utility functions
import { supabase as mockedSupabase } from '../supabaseClient';


// --- TEST DATA ---
const CHARACTER_ID = "char-123";
const USER_ID = "user-abc";
const MESSAGES: ChatMessage[] = [
  { role: "user", text: "Hello there" },
  { role: "model", text: "General Kenobi" },
];
const DB_ROWS = [
  { id: '1', character_id: CHARACTER_ID, user_id: USER_ID, message_role: 'user', message_text: 'Hello there', created_at: '2024-01-01T00:00:00Z' },
  { id: '2', character_id: CHARACTER_ID, user_id: USER_ID, message_role: 'model', message_text: 'General Kenobi', created_at: '2024-01-01T00:00:01Z' },
];

describe("conversationHistoryService", () => {
  let mocks: any;
  // Cast the imported client to the extended type
  const supabase = mockedSupabase as SupabaseClient & { setNextResolvedValue: (value: any) => void, _mocks: any };


  beforeEach(() => {
    // FIX: Use the already mocked and imported client directly.
    mocks = supabase._mocks;

    // Reset spies on mocks before each test
    Object.values(mocks).forEach(mock => {
        if (typeof mock === 'function' && 'mockClear' in mock) {
            (mock as vi.Mock).mockClear();
        }
    });
    // The main mock function implementations need to be preserved, only clear calls
    
    // Set a default resolved value for safety, although the mocks are generally mocked per-test or per-call chain
    supabase.setNextResolvedValue({ data: null, error: null });
  });

  // --- saveConversationHistory TESTS ---
  describe("saveConversationHistory", () => {
    it("should batch insert messages when saving history", async () => {
      // Set the result that the mocked .insert().then() should return
      mocks.insert.mockReturnValueOnce({ error: null });

      await saveConversationHistory(USER_ID, MESSAGES);

      expect(mocks.from).toHaveBeenCalledWith("conversation_history");
      expect(mocks.insert).toHaveBeenCalledTimes(1);
      const insertedRows = mocks.insert.mock.calls[0][0];
      expect(insertedRows.length).toBe(2);
      expect(insertedRows[0].message_text).toBe("Hello there");
      expect(insertedRows[1].message_role).toBe("model");
    });

    it("should return immediately and not call insert if messages array is empty", async () => {
      await saveConversationHistory(USER_ID, []);

      expect(mocks.insert).not.toHaveBeenCalled();
    });

    it("should log error but not throw if database insert fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // We set the resolved value *before* the service calls insert()
      mocks.insert.mockReturnValueOnce({ error: new Error("DB Error") });

      await expect(saveConversationHistory(USER_ID, MESSAGES)).resolves.toBeUndefined();
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error saving conversation history:",
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  // --- loadConversationHistory TESTS ---
  describe("loadConversationHistory", () => {
    it("should load messages in chronological order and map to ChatMessage[]", async () => {
      supabase.setNextResolvedValue({ data: DB_ROWS, error: null });

      const result = await loadConversationHistory(USER_ID);

      expect(mocks.from).toHaveBeenCalledWith("conversation_history");
      expect(mocks.select).toHaveBeenCalledWith('*');
      // expect(mocks.eq).toHaveBeenCalledWith("character_id", CHARACTER_ID); // Removed
      expect(mocks.eq).toHaveBeenCalledWith("user_id", USER_ID);
      expect(mocks.order).toHaveBeenCalledWith('created_at', { ascending: true });
      
      expect(result).toEqual(MESSAGES);
    });

    it("should return empty array if no messages are found", async () => {
      supabase.setNextResolvedValue({ data: [], error: null });

      const result = await loadConversationHistory(USER_ID);

      expect(result).toEqual([]);
    });

    it("should return empty array and log error if database query fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      supabase.setNextResolvedValue({
        data: null,
        error: { message: "Query failed" },
      });

      const result = await loadConversationHistory(USER_ID);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to load conversation history:",
        expect.any(Object)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  // --- appendConversationHistory TESTS ---
  describe("appendConversationHistory", () => {
    const NEW_MESSAGES: ChatMessage[] = [
      { role: "user", text: "One more user message" },
      { role: "model", text: "One more model response" },
    ];

    it("should batch insert new messages when appending history", async () => {
      mocks.insert.mockReturnValueOnce({ error: null });

      await appendConversationHistory(USER_ID, NEW_MESSAGES);

      expect(mocks.from).toHaveBeenCalledWith("conversation_history");
      expect(mocks.insert).toHaveBeenCalledTimes(1);
      const insertedRows = mocks.insert.mock.calls[0][0];
      expect(insertedRows.length).toBe(2);
      expect(insertedRows[0].message_text).toBe("One more user message");
    });

    it("should return immediately and not call insert if messages array is empty", async () => {
      await appendConversationHistory(USER_ID, []);

      expect(mocks.insert).not.toHaveBeenCalled();
    });

    it("should log error but not throw if database insert fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.insert.mockReturnValueOnce({ error: new Error("Append DB Error") });

      await expect(appendConversationHistory(USER_ID, NEW_MESSAGES)).resolves.toBeUndefined();
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error appending conversation history:",
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  // --- clearConversationHistory TESTS ---
  describe("clearConversationHistory", () => {
    it("should delete all history for the user-character pair", async () => {
      supabase.setNextResolvedValue({ data: null, error: null });

      await clearConversationHistory(USER_ID);

      expect(mocks.from).toHaveBeenCalledWith("conversation_history");
      expect(mocks.delete).toHaveBeenCalledTimes(1);
      // expect(mocks.eq).toHaveBeenCalledWith("character_id", CHARACTER_ID); // Removed
      expect(mocks.eq).toHaveBeenCalledWith("user_id", USER_ID);
    });

    it("should throw error if database delete fails", async () => {
      const error = { message: "Delete failed" };
      supabase.setNextResolvedValue({ data: null, error });

      // We expect the function to re-throw the error
      await expect(clearConversationHistory(USER_ID)).rejects.toThrow();
    });
  });
});