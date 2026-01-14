// src/services/__tests__/messageOrchestrator.test.ts

/**
 * Message Orchestrator Tests
 *
 * TDD: These tests were written BEFORE the implementation.
 * They define the expected behavior of the orchestrator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processUserMessage,
  detectCalendarQuery,
  formatEventsForContext,
} from '../messageOrchestrator';
import {
  ActionType,
  CalendarQueryType,
  ProcessingStage,
  type OrchestratorInput,
} from '../../handlers/messageActions/types';

// ============================================================================
// MOCKS
// ============================================================================

// Mock the calendar service
vi.mock('../calendarService', () => ({
  calendarService: {
    getUpcomingEvents: vi.fn().mockResolvedValue([]),
  },
}));

// Mock conversation history service
vi.mock('../conversationHistoryService', () => ({
  appendConversationHistory: vi.fn().mockResolvedValue(undefined),
}));

// Mock memory service (for fact processing)
vi.mock('../memoryService', () => ({
  processDetectedFacts: vi.fn().mockResolvedValue(undefined),
}));

// Mock presence detection
vi.mock('../kayleyPresenceDetector', () => ({
  detectKayleyPresence: vi.fn().mockResolvedValue(null),
}));

vi.mock('../kayleyPresenceService', () => ({
  updateKayleyPresenceState: vi.fn().mockResolvedValue(undefined),
  getDefaultExpirationMinutes: vi.fn().mockReturnValue(60),
  getKayleyPresenceState: vi.fn().mockResolvedValue(null),
}));

// Mock action handlers (Phase 4 + Phase 6)
vi.mock('../../handlers/messageActions', () => ({
  processCalendarAction: vi.fn().mockResolvedValue({ handled: false }),
  parseCalendarTagFromResponse: vi.fn().mockReturnValue(null),
  processCalendarTag: vi.fn().mockResolvedValue({ handled: false }),
  processNewsAction: vi.fn().mockResolvedValue({ handled: false, stories: [], newsPrompt: '' }),
  processSelfieAction: vi.fn().mockResolvedValue({ handled: false, success: false }),
  parseTaskActionFromResponse: vi.fn().mockReturnValue(null),
  detectTaskCompletionFallback: vi.fn().mockReturnValue(null),
}));

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createMockAIService() {
  return {
    model: 'test-model',
    generateResponse: vi.fn().mockResolvedValue({
      response: { text_response: 'Hello!' },
      session: { model: 'test-model', interactionId: 'test-123' },
      audioData: 'mock-audio-base64',
      intent: null,
    }),
  };
}

function createMockInput(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  return {
    userMessage: 'Hello there',
    aiService: createMockAIService() as any,
    session: { model: 'test-model' },
    accessToken: 'mock-token',
    chatHistory: [],
    upcomingEvents: [],
    tasks: [],
    isMuted: false,
    ...overrides,
  };
}

const mockCalendarEvents = [
  {
    id: 'event-1',
    summary: 'Team standup',
    start: { dateTime: '2025-01-05T10:00:00Z' },
    end: { dateTime: '2025-01-05T10:30:00Z' },
  },
  {
    id: 'event-2',
    summary: 'Lunch with Sarah',
    start: { dateTime: '2025-01-05T12:00:00Z' },
    end: { dateTime: '2025-01-05T13:00:00Z' },
  },
];

// ============================================================================
// DETECT CALENDAR QUERY TESTS
// ============================================================================

describe('detectCalendarQuery', () => {
  describe('should return NONE for non-calendar messages', () => {
    it('handles simple greetings', () => {
      expect(detectCalendarQuery('hello')).toBe(CalendarQueryType.NONE);
      expect(detectCalendarQuery('hi there')).toBe(CalendarQueryType.NONE);
      expect(detectCalendarQuery('how are you')).toBe(CalendarQueryType.NONE);
    });

    it('handles random questions', () => {
      expect(detectCalendarQuery('what is the weather')).toBe(CalendarQueryType.NONE);
      expect(detectCalendarQuery('tell me a joke')).toBe(CalendarQueryType.NONE);
    });
  });

  describe('should return READ for schedule questions', () => {
    it('detects "calendar" keyword', () => {
      expect(detectCalendarQuery('what is on my calendar')).toBe(CalendarQueryType.READ);
      expect(detectCalendarQuery('show me my calendar')).toBe(CalendarQueryType.READ);
    });

    it('detects "schedule" keyword', () => {
      expect(detectCalendarQuery('what is my schedule today')).toBe(CalendarQueryType.READ);
      expect(detectCalendarQuery('do I have anything scheduled')).toBe(CalendarQueryType.READ);
    });

    it('detects "meeting" keyword', () => {
      expect(detectCalendarQuery('do I have any meetings')).toBe(CalendarQueryType.READ);
      expect(detectCalendarQuery('when is my next meeting')).toBe(CalendarQueryType.READ);
    });

    it('detects "event" keyword', () => {
      expect(detectCalendarQuery('what events do I have')).toBe(CalendarQueryType.READ);
      expect(detectCalendarQuery('any events today')).toBe(CalendarQueryType.READ);
    });

    it('detects "today" and "tomorrow" keywords', () => {
      expect(detectCalendarQuery('what do I have today')).toBe(CalendarQueryType.READ);
      expect(detectCalendarQuery('what is happening tomorrow')).toBe(CalendarQueryType.READ);
    });

    it('detects "appointment" keyword', () => {
      expect(detectCalendarQuery('do I have any appointments')).toBe(CalendarQueryType.READ);
    });

    it('detects "plan" keyword', () => {
      expect(detectCalendarQuery('what are my plans for today')).toBe(CalendarQueryType.READ);
    });
  });

  describe('should return WRITE for modification requests', () => {
    it('detects "delete" keyword', () => {
      expect(detectCalendarQuery('delete my meeting')).toBe(CalendarQueryType.WRITE);
      expect(detectCalendarQuery('delete the event')).toBe(CalendarQueryType.WRITE);
    });

    it('detects "remove" keyword', () => {
      expect(detectCalendarQuery('remove my appointment')).toBe(CalendarQueryType.WRITE);
      expect(detectCalendarQuery('remove the meeting')).toBe(CalendarQueryType.WRITE);
    });

    it('detects "cancel" keyword', () => {
      expect(detectCalendarQuery('cancel my meeting')).toBe(CalendarQueryType.WRITE);
      expect(detectCalendarQuery('cancel the event')).toBe(CalendarQueryType.WRITE);
    });

    it('detects "add" keyword', () => {
      expect(detectCalendarQuery('add a meeting')).toBe(CalendarQueryType.WRITE);
      expect(detectCalendarQuery('add event tomorrow')).toBe(CalendarQueryType.WRITE);
    });

    it('detects "create" keyword', () => {
      expect(detectCalendarQuery('create a meeting')).toBe(CalendarQueryType.WRITE);
      expect(detectCalendarQuery('create an event')).toBe(CalendarQueryType.WRITE);
    });

    it('detects "schedule" as write when combined with action words', () => {
      expect(detectCalendarQuery('schedule a meeting')).toBe(CalendarQueryType.WRITE);
    });
  });

  describe('edge cases', () => {
    it('is case insensitive', () => {
      expect(detectCalendarQuery('WHAT IS ON MY CALENDAR')).toBe(CalendarQueryType.READ);
      expect(detectCalendarQuery('DELETE MY MEETING')).toBe(CalendarQueryType.WRITE);
    });

    it('handles mixed case', () => {
      expect(detectCalendarQuery('What Is On My Calendar')).toBe(CalendarQueryType.READ);
    });
  });
});

// ============================================================================
// FORMAT EVENTS FOR CONTEXT TESTS
// ============================================================================

describe('formatEventsForContext', () => {
  it('should format events as a readable list', () => {
    const formatted = formatEventsForContext(mockCalendarEvents);

    expect(formatted).toContain('Team standup');
    expect(formatted).toContain('event-1');
    expect(formatted).toContain('Lunch with Sarah');
    expect(formatted).toContain('event-2');
  });

  it('should return empty string for no events', () => {
    expect(formatEventsForContext([])).toBe('');
  });

  it('should include event IDs for deletion reference', () => {
    const formatted = formatEventsForContext(mockCalendarEvents);
    expect(formatted).toContain('ID: event-1');
    expect(formatted).toContain('ID: event-2');
  });
});

// ============================================================================
// PROCESS USER MESSAGE TESTS
// ============================================================================

describe('processUserMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('should return a valid OrchestratorResult', async () => {
      const input = createMockInput();
      const result = await processUserMessage(input);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('actionType');
      expect(result).toHaveProperty('stage');
      expect(result).toHaveProperty('chatMessages');
      expect(result).toHaveProperty('refreshCalendar');
      expect(result).toHaveProperty('refreshTasks');
      expect(result).toHaveProperty('openTaskPanel');
    });

    it('should call AI service with user message', async () => {
      const mockService = createMockAIService();
      const input = createMockInput({
        aiService: mockService as any,
        userMessage: 'test message',
      });

      await processUserMessage(input);

      expect(mockService.generateResponse).toHaveBeenCalled();
    });

    it('should return success=true for successful response', async () => {
      const input = createMockInput();
      const result = await processUserMessage(input);

      expect(result.success).toBe(true);
      expect(result.stage).toBe(ProcessingStage.COMPLETE);
    });

    it('should include AI response in chatMessages', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: { text_response: 'Hello friend!' },
        session: { model: 'test-model' },
      });

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.chatMessages).toHaveLength(1);
      expect(result.chatMessages[0].text).toBe('Hello friend!');
      expect(result.chatMessages[0].role).toBe('model');
    });

    it('should include audio data when not muted', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: { text_response: 'Hello!' },
        session: { model: 'test-model' },
        audioData: 'audio-base64-data',
      });

      const input = createMockInput({
        aiService: mockService as any,
        isMuted: false,
      });
      const result = await processUserMessage(input);

      expect(result.audioToPlay).toBe('audio-base64-data');
    });

    it('should NOT include audio data when muted', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: { text_response: 'Hello!' },
        session: { model: 'test-model' },
        audioData: 'audio-base64-data',
      });

      const input = createMockInput({
        aiService: mockService as any,
        isMuted: true,
      });
      const result = await processUserMessage(input);

      expect(result.audioToPlay).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should return success=false when AI service throws', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockRejectedValue(new Error('AI service failed'));

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.success).toBe(false);
      expect(result.stage).toBe(ProcessingStage.ERROR);
      expect(result.error).toContain('AI service failed');
    });

    it('should return actionType=NONE on error', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockRejectedValue(new Error('Failed'));

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.actionType).toBe(ActionType.NONE);
    });
  });

  describe('action type detection', () => {
    it('should detect TASK action type', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: {
          text_response: 'Added task!',
          task_action: { action: 'create', text: 'Buy milk' },
        },
        session: { model: 'test-model' },
      });

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.actionType).toBe(ActionType.TASK);
    });

    it('should detect CALENDAR action type', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: {
          text_response: 'Created event!',
          calendar_action: { action: 'create', title: 'Meeting' },
        },
        session: { model: 'test-model' },
      });

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.actionType).toBe(ActionType.CALENDAR);
    });

    it('should detect NEWS action type', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: {
          text_response: 'Let me get the news...',
          news_action: { action: 'fetch' },
        },
        session: { model: 'test-model' },
      });

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.actionType).toBe(ActionType.NEWS);
    });

    it('should detect SELFIE action type', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: {
          text_response: 'Taking a pic...',
          selfie_action: { scene: 'cozy at home' },
        },
        session: { model: 'test-model' },
      });

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.actionType).toBe(ActionType.SELFIE);
    });

    it('should return NONE when no action present', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: { text_response: 'Just chatting!' },
        session: { model: 'test-model' },
      });

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.actionType).toBe(ActionType.NONE);
    });
  });

  describe('session handling', () => {
    it('should return updated session', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: { text_response: 'Hello!' },
        session: { model: 'test-model', interactionId: 'new-session-123' },
      });

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.updatedSession).toEqual({
        model: 'test-model',
        interactionId: 'new-session-123',
      });
    });
  });

  describe('action playback', () => {
    it('should include action_id when present', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: {
          text_response: 'Hello!',
          action_id: 'wave',
        },
        session: { model: 'test-model' },
      });

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.actionToPlay).toBe('wave');
    });
  });

  describe('app opening', () => {
    it('should include open_app URL when present', async () => {
      const mockService = createMockAIService();
      mockService.generateResponse.mockResolvedValue({
        response: {
          text_response: 'Opening Spotify!',
          open_app: 'spotify://track/123',
        },
        session: { model: 'test-model' },
      });

      const input = createMockInput({ aiService: mockService as any });
      const result = await processUserMessage(input);

      expect(result.appToOpen).toBe('spotify://track/123');
    });
  });
});
