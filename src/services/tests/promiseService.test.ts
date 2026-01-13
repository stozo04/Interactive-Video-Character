/**
 * Promise Service Tests (TDD - Test First!)
 *
 * Tests for the Promise Tracking System that makes Kayley's future commitments feel real.
 *
 * Core functionality:
 * - Create promises when Kayley commits to something later
 * - Fixed 10-minute timing (extensible architecture for future)
 * - Fulfill promises by creating pending messages
 * - Handle offline users (promises wait until they return)
 *
 * Test coverage:
 * - createPromise() - Create with fixed 10-minute timing
 * - getReadyPromises() - Find promises ready to fulfill
 * - getPendingPromises() - Get all pending promises
 * - fulfillPromise() - Mark fulfilled and create pending message
 * - checkAndFulfillPromises() - Background job to fulfill ready promises
 * - cancelPromise() - Cancel a promise
 * - cleanupOldPromises() - Remove old fulfilled/cancelled promises
 * - Edge cases: empty results, invalid IDs, already fulfilled
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromiseType } from '../promiseService';

// Mock Supabase client
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockLte = vi.fn();
const mockLt = vi.fn();
const mockIn = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
    })),
  },
}));

// Mock pendingMessageService
const mockCreatePendingMessage = vi.fn();

vi.mock('../idleLife/pendingMessageService', () => ({
  createPendingMessage: (...args: any[]) => mockCreatePendingMessage(...args),
}));

// Import after mocks are set up
import {
  createPromise,
  getReadyPromises,
  getPendingPromises,
  fulfillPromise,
  checkAndFulfillPromises,
  cancelPromise,
  cleanupOldPromises,
} from '../promiseService';

describe('promiseService (TDD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock chain - properly set up for all Supabase query patterns
    // Pattern 1: select().eq().eq().lte().order() for getReadyPromises
    // Pattern 2: select().eq().eq().order() for getPendingPromises
    // Pattern 3: select().eq().single() for fulfillPromise
    // Pattern 4: insert().select().single() for createPromise
    // Pattern 5: update().eq() for fulfillPromise/cancelPromise
    // Pattern 6: delete().in().lt() for cleanupOldPromises

    mockSelect.mockReturnValue({
      eq: mockEq,
      single: mockSingle
    });

    mockInsert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) });

    mockUpdate.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

    mockDelete.mockReturnValue({
      in: vi.fn().mockReturnValue({
        lt: vi.fn().mockResolvedValue({ error: null })
      })
    });

    mockEq.mockReturnValue({
      eq: mockEq,
      lte: mockLte,
      order: mockOrder,
      single: mockSingle
    });

    mockLte.mockReturnValue({ order: mockOrder });
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockSingle.mockResolvedValue({ data: null, error: null });
  });

  // ============================================
  // createPromise Tests
  // ============================================

  describe('createPromise', () => {
    it('should create a promise with fixed 10-minute timing', async () => {
      const now = Date.now();
      const mockPromiseData = {
        id: 'promise_123',
        promise_type: 'send_selfie',
        description: 'Send selfie from hot girl walk',
        trigger_event: 'when I go on my walk',
        estimated_timing: new Date(now + 10 * 60 * 1000).toISOString(),
        commitment_context: 'User asked for selfie',
        fulfillment_data: {
          messageText: 'Okay heading out! Here\'s your selfie 📸',
          selfieParams: { scene: 'outdoor trail', mood: 'energetic' },
        },
        status: 'pending',
        created_at: new Date(now).toISOString(),
      };

      mockInsert.mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockPromiseData, error: null }),
        }),
      });

      const result = await createPromise(
        'send_selfie' as PromiseType,
        'Send selfie from hot girl walk',
        'when I go on my walk',
        new Date(now + 10 * 60 * 1000),
        'User asked for selfie',
        {
          messageText: 'Okay heading out! Here\'s your selfie 📸',
          selfieParams: { scene: 'outdoor trail', mood: 'energetic' },
        }
      );

      expect(result).toBeDefined();
      expect(result?.promiseType).toBe('send_selfie');
      expect(result?.description).toBe('Send selfie from hot girl walk');
      expect(result?.status).toBe('pending');
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should create a promise without fulfillment data', async () => {
      const mockPromiseData = {
        id: 'promise_456',
        promise_type: 'follow_up',
        description: 'Check in later',
        trigger_event: 'in a bit',
        estimated_timing: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        commitment_context: 'User seemed down',
        fulfillment_data: {},
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      mockInsert.mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockPromiseData, error: null }),
        }),
      });

      const result = await createPromise(
        'follow_up' as PromiseType,
        'Check in later',
        'in a bit',
        new Date(Date.now() + 10 * 60 * 1000),
        'User seemed down'
      );

      expect(result).toBeDefined();
      expect(result?.promiseType).toBe('follow_up');
      expect(result?.fulfillmentData).toEqual({});
    });

    it('should return null on database error', async () => {
      mockInsert.mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB Error' } }),
        }),
      });

      const result = await createPromise(
        'send_selfie' as PromiseType,
        'Test promise',
        'later',
        new Date(Date.now() + 10 * 60 * 1000),
        'Test context'
      );

      expect(result).toBeNull();
    });
  });

  // ============================================
  // getReadyPromises Tests
  // ============================================

  describe('getReadyPromises', () => {
    it('should return promises past their estimated timing', async () => {
      const pastTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago
      const mockReadyPromises = [
        {
          id: 'ready_1',
          promise_type: 'send_selfie',
          description: 'Send selfie',
          trigger_event: 'when I go on walk',
          estimated_timing: pastTime,
          commitment_context: 'User request',
          fulfillment_data: {},
          status: 'pending',
          created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        },
      ];

      // Mock chain: .select().eq(status).lte(timing).order()
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: mockReadyPromises, error: null }),
          }),
        }),
      });

      const result = await getReadyPromises();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ready_1');
      expect(result[0].status).toBe('pending');
    });

    it('should return empty array if no ready promises', async () => {
      // Mock chain: .select().eq(status).lte(timing).order()
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const result = await getReadyPromises();

      expect(result).toEqual([]);
    });

    it('should return empty array on database error', async () => {
      // Mock chain: .select().eq(status).lte(timing).order()
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB Error' } }),
          }),
        }),
      });

      const result = await getReadyPromises();

      expect(result).toEqual([]);
    });
  });

  // ============================================
  // getPendingPromises Tests
  // ============================================

  describe('getPendingPromises', () => {
    it('should return all pending promises sorted by timing', async () => {
      const mockPendingPromises = [
        {
          id: 'pending_1',
          promise_type: 'send_selfie',
          description: 'Send selfie',
          trigger_event: 'later',
          estimated_timing: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          commitment_context: 'Context',
          fulfillment_data: {},
          status: 'pending',
          created_at: new Date().toISOString(),
        },
        {
          id: 'pending_2',
          promise_type: 'follow_up',
          description: 'Check in',
          trigger_event: 'in a bit',
          estimated_timing: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          commitment_context: 'Context',
          fulfillment_data: {},
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ];

      // Mock chain: .select().eq(status).order()
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: mockPendingPromises, error: null }),
        }),
      });

      const result = await getPendingPromises();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('pending');
      expect(result[1].status).toBe('pending');
    });

    it('should return empty array if no pending promises', async () => {
      // Mock chain: .select().eq(status).order()
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });

      const result = await getPendingPromises();

      expect(result).toEqual([]);
    });
  });

  // ============================================
  // fulfillPromise Tests
  // ============================================

  describe('fulfillPromise', () => {
    it('should fulfill a send_selfie promise and create pending message', async () => {
      const mockPromise = {
        id: 'promise_fulfill',
        promise_type: 'send_selfie',
        description: 'Send selfie from walk',
        trigger_event: 'when I go on walk',
        estimated_timing: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        commitment_context: 'User request',
        fulfillment_data: {
          messageText: 'Heading out now! 📸',
          selfieParams: { scene: 'outdoor', mood: 'happy' },
        },
        status: 'pending',
        created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      };

      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockPromise, error: null }),
        }),
      });

      mockUpdate.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockCreatePendingMessage.mockResolvedValue({
        id: 'pending_msg_1',
        messageText: 'Heading out now! 📸',
      });

      const result = await fulfillPromise('promise_fulfill');

      expect(result).toBe(true);
      expect(mockCreatePendingMessage).toHaveBeenCalledWith({
        messageText: 'Heading out now! 📸',
        messageType: 'photo',
        trigger: 'promise',
        priority: 'normal',
        metadata: {
          promiseId: 'promise_fulfill',
          selfieParams: { scene: 'outdoor', mood: 'happy' },
        },
      });
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should fulfill a share_update promise with text message', async () => {
      const mockPromise = {
        id: 'promise_update',
        promise_type: 'share_update',
        description: 'Share audition results',
        trigger_event: 'after audition',
        estimated_timing: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        commitment_context: 'User asked',
        fulfillment_data: {
          messageText: 'Just got out of the audition! It went pretty well actually',
        },
        status: 'pending',
        created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      };

      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockPromise, error: null }),
        }),
      });

      mockUpdate.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockCreatePendingMessage.mockResolvedValue({
        id: 'pending_msg_2',
      });

      const result = await fulfillPromise('promise_update');

      expect(result).toBe(true);
      expect(mockCreatePendingMessage).toHaveBeenCalledWith({
        messageText: 'Just got out of the audition! It went pretty well actually',
        messageType: 'text',
        trigger: 'promise',
        priority: 'normal',
        metadata: {},
      });
    });

    it('should use default message text if not provided', async () => {
      const mockPromise = {
        id: 'promise_default',
        promise_type: 'follow_up',
        description: 'Check in',
        trigger_event: 'later',
        estimated_timing: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        commitment_context: 'Context',
        fulfillment_data: {},
        status: 'pending',
        created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      };

      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockPromise, error: null }),
        }),
      });

      mockUpdate.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockCreatePendingMessage.mockResolvedValue({ id: 'msg' });

      const result = await fulfillPromise('promise_default');

      expect(result).toBe(true);
      expect(mockCreatePendingMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageText: expect.stringContaining('Hey! Checking in'),
        })
      );
    });

    it('should return false if promise not found', async () => {
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
        }),
      });

      const result = await fulfillPromise('nonexistent_promise');

      expect(result).toBe(false);
      expect(mockCreatePendingMessage).not.toHaveBeenCalled();
    });

    it('should return false if update fails', async () => {
      const mockPromise = {
        id: 'promise_fail',
        promise_type: 'send_selfie',
        description: 'Test',
        trigger_event: 'later',
        estimated_timing: new Date().toISOString(),
        commitment_context: 'Context',
        fulfillment_data: {},
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockPromise, error: null }),
        }),
      });

      mockUpdate.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } }),
      });

      mockCreatePendingMessage.mockResolvedValue({ id: 'msg' });

      const result = await fulfillPromise('promise_fail');

      expect(result).toBe(false);
    });
  });

  // ============================================
  // checkAndFulfillPromises Tests
  // ============================================

  describe('checkAndFulfillPromises', () => {
    it('should fulfill multiple ready promises', async () => {
      const mockReadyPromises = [
        {
          id: 'ready_1',
          promise_type: 'send_selfie',
          description: 'Selfie 1',
          trigger_event: 'walk',
          estimated_timing: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          commitment_context: 'Context',
          fulfillment_data: { messageText: 'Here!' },
          status: 'pending',
          created_at: new Date().toISOString(),
        },
        {
          id: 'ready_2',
          promise_type: 'follow_up',
          description: 'Check in',
          trigger_event: 'later',
          estimated_timing: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          commitment_context: 'Context',
          fulfillment_data: {},
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ];

      // First call: getReadyPromises - mock chain: .select().eq(status).lte(timing).order()
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: mockReadyPromises, error: null }),
          }),
        }),
      });

      // Subsequent calls: fulfillPromise - mock chain: .select().eq(id).single()
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockImplementation(async () => {
            // Return the promise being fulfilled
            return { data: mockReadyPromises.shift(), error: null };
          }),
        }),
      });

      mockUpdate.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockCreatePendingMessage.mockResolvedValue({ id: 'msg' });

      const result = await checkAndFulfillPromises();

      expect(result).toBe(2);
      expect(mockCreatePendingMessage).toHaveBeenCalledTimes(2);
    });

    it('should return 0 if no ready promises', async () => {
      // Mock chain: .select().eq(status).lte(timing).order()
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const result = await checkAndFulfillPromises();

      expect(result).toBe(0);
      expect(mockCreatePendingMessage).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // cancelPromise Tests
  // ============================================

  describe('cancelPromise', () => {
    it('should cancel a promise', async () => {
      mockUpdate.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      await cancelPromise('promise_to_cancel');

      expect(mockUpdate).toHaveBeenCalledWith({ status: 'cancelled' });
    });

    it('should handle errors gracefully', async () => {
      mockUpdate.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'Error' } }),
      });

      // Should not throw
      await expect(cancelPromise('promise_fail')).resolves.toBeUndefined();
    });
  });

  // ============================================
  // cleanupOldPromises Tests
  // ============================================

  describe('cleanupOldPromises', () => {
    it('should delete old fulfilled and cancelled promises', async () => {
      mockDelete.mockReturnValue({
        in: vi.fn().mockReturnValue({
          lt: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      await cleanupOldPromises();

      expect(mockDelete).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockDelete.mockReturnValue({
        in: vi.fn().mockReturnValue({
          lt: vi.fn().mockResolvedValue({ error: { message: 'Error' } }),
        }),
      });

      // Should not throw
      await expect(cleanupOldPromises()).resolves.toBeUndefined();
    });
  });
});
