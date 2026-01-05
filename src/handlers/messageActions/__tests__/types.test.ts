// src/handlers/messageActions/__tests__/types.test.ts

import { describe, it, expect } from 'vitest';
import {
  // Enums
  ActionType,
  CalendarQueryType,
  ProcessingStage,
  // Type guards
  isValidActionType,
  isValidCalendarQueryType,
  isValidProcessingStage,
  // Factory functions
  createEmptyResult,
  createSuccessResult,
  createErrorResult,
  createUnhandledResult,
  determineActionType,
} from '../types';

// ============================================================================
// ENUM TESTS
// ============================================================================

describe('ActionType Enum', () => {
  it('should have all expected values', () => {
    expect(ActionType.TASK).toBe('task');
    expect(ActionType.CALENDAR).toBe('calendar');
    expect(ActionType.NEWS).toBe('news');
    expect(ActionType.SELFIE).toBe('selfie');
    expect(ActionType.NONE).toBe('none');
  });

  it('should have exactly 5 values', () => {
    const values = Object.values(ActionType);
    expect(values).toHaveLength(5);
  });
});

describe('CalendarQueryType Enum', () => {
  it('should have all expected values', () => {
    expect(CalendarQueryType.NONE).toBe('none');
    expect(CalendarQueryType.READ).toBe('read');
    expect(CalendarQueryType.WRITE).toBe('write');
  });

  it('should have exactly 3 values', () => {
    const values = Object.values(CalendarQueryType);
    expect(values).toHaveLength(3);
  });
});

describe('ProcessingStage Enum', () => {
  it('should have all expected values', () => {
    expect(ProcessingStage.PREPROCESSING).toBe('preprocessing');
    expect(ProcessingStage.AI_CALL).toBe('ai_call');
    expect(ProcessingStage.ACTION_ROUTING).toBe('action_routing');
    expect(ProcessingStage.POSTPROCESSING).toBe('postprocessing');
    expect(ProcessingStage.COMPLETE).toBe('complete');
    expect(ProcessingStage.ERROR).toBe('error');
  });

  it('should have exactly 6 values', () => {
    const values = Object.values(ProcessingStage);
    expect(values).toHaveLength(6);
  });
});

// ============================================================================
// TYPE GUARD TESTS
// ============================================================================

describe('isValidActionType', () => {
  it('should return true for valid action types', () => {
    expect(isValidActionType('task')).toBe(true);
    expect(isValidActionType('calendar')).toBe(true);
    expect(isValidActionType('news')).toBe(true);
    expect(isValidActionType('selfie')).toBe(true);
    expect(isValidActionType('none')).toBe(true);
  });

  it('should return false for invalid action types', () => {
    expect(isValidActionType('invalid')).toBe(false);
    expect(isValidActionType('')).toBe(false);
    expect(isValidActionType('TASK')).toBe(false); // case sensitive
    expect(isValidActionType('email')).toBe(false);
  });
});

describe('isValidCalendarQueryType', () => {
  it('should return true for valid calendar query types', () => {
    expect(isValidCalendarQueryType('none')).toBe(true);
    expect(isValidCalendarQueryType('read')).toBe(true);
    expect(isValidCalendarQueryType('write')).toBe(true);
  });

  it('should return false for invalid calendar query types', () => {
    expect(isValidCalendarQueryType('invalid')).toBe(false);
    expect(isValidCalendarQueryType('')).toBe(false);
    expect(isValidCalendarQueryType('READ')).toBe(false); // case sensitive
    expect(isValidCalendarQueryType('delete')).toBe(false);
  });
});

describe('isValidProcessingStage', () => {
  it('should return true for valid processing stages', () => {
    expect(isValidProcessingStage('preprocessing')).toBe(true);
    expect(isValidProcessingStage('ai_call')).toBe(true);
    expect(isValidProcessingStage('action_routing')).toBe(true);
    expect(isValidProcessingStage('postprocessing')).toBe(true);
    expect(isValidProcessingStage('complete')).toBe(true);
    expect(isValidProcessingStage('error')).toBe(true);
  });

  it('should return false for invalid processing stages', () => {
    expect(isValidProcessingStage('invalid')).toBe(false);
    expect(isValidProcessingStage('')).toBe(false);
    expect(isValidProcessingStage('COMPLETE')).toBe(false); // case sensitive
    expect(isValidProcessingStage('pending')).toBe(false);
  });
});

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createEmptyResult', () => {
  it('should create a default empty result', () => {
    const result = createEmptyResult();

    expect(result.success).toBe(false);
    expect(result.actionType).toBe(ActionType.NONE);
    expect(result.stage).toBe(ProcessingStage.PREPROCESSING);
    expect(result.chatMessages).toEqual([]);
    expect(result.refreshCalendar).toBe(false);
    expect(result.refreshTasks).toBe(false);
    expect(result.openTaskPanel).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('should accept a custom stage', () => {
    const result = createEmptyResult(ProcessingStage.AI_CALL);
    expect(result.stage).toBe(ProcessingStage.AI_CALL);
  });
});

describe('createSuccessResult', () => {
  it('should create a success result with chat message', () => {
    const result = createSuccessResult('Hello world!');

    expect(result.success).toBe(true);
    expect(result.actionType).toBe(ActionType.NONE);
    expect(result.stage).toBe(ProcessingStage.COMPLETE);
    expect(result.chatMessages).toHaveLength(1);
    expect(result.chatMessages[0]).toEqual({ role: 'model', text: 'Hello world!' });
    expect(result.refreshCalendar).toBe(false);
    expect(result.refreshTasks).toBe(false);
  });

  it('should accept a custom action type', () => {
    const result = createSuccessResult('Task added!', ActionType.TASK);
    expect(result.actionType).toBe(ActionType.TASK);
  });
});

describe('createErrorResult', () => {
  it('should create an error result', () => {
    const result = createErrorResult('Something went wrong');

    expect(result.success).toBe(false);
    expect(result.actionType).toBe(ActionType.NONE);
    expect(result.stage).toBe(ProcessingStage.ERROR);
    expect(result.chatMessages).toEqual([]);
    expect(result.error).toBe('Something went wrong');
  });

  it('should accept a custom stage', () => {
    const result = createErrorResult('AI failed', ProcessingStage.AI_CALL);
    expect(result.stage).toBe(ProcessingStage.AI_CALL);
    expect(result.error).toBe('AI failed');
  });
});

describe('createUnhandledResult', () => {
  it('should create an unhandled action result', () => {
    const result = createUnhandledResult();

    expect(result.handled).toBe(false);
    expect(result.success).toBe(false);
    expect(result.chatMessages).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});

// ============================================================================
// DETERMINE ACTION TYPE TESTS
// ============================================================================

describe('determineActionType', () => {
  it('should return TASK when task_action is present', () => {
    const response = { task_action: { action: 'create', text: 'Buy milk' } } as any;
    expect(determineActionType(response)).toBe(ActionType.TASK);
  });

  it('should return CALENDAR when calendar_action is present', () => {
    const response = { calendar_action: { action: 'create' } } as any;
    expect(determineActionType(response)).toBe(ActionType.CALENDAR);
  });

  it('should return NEWS when news_action is present', () => {
    const response = { news_action: { action: 'fetch' } } as any;
    expect(determineActionType(response)).toBe(ActionType.NEWS);
  });

  it('should return SELFIE when selfie_action is present', () => {
    const response = { selfie_action: { scene: 'cozy' } } as any;
    expect(determineActionType(response)).toBe(ActionType.SELFIE);
  });

  it('should return NONE when no action is present', () => {
    const response = { text_response: 'Hello!' } as any;
    expect(determineActionType(response)).toBe(ActionType.NONE);
  });

  it('should prioritize in order: TASK > CALENDAR > NEWS > SELFIE', () => {
    // When multiple actions present, first in the check order wins
    const response = {
      task_action: { action: 'create' },
      calendar_action: { action: 'create' },
    } as any;
    expect(determineActionType(response)).toBe(ActionType.TASK);
  });
});
