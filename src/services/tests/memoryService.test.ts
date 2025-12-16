import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeMemoryTool, ToolCallArgs, ToolExecutionContext } from '../memoryService';

// Mock dependencies
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

const mockCreateEvent = vi.fn();
const mockDeleteEvent = vi.fn();

vi.mock('../calendarService', () => ({
  calendarService: {
    createEvent: (...args: any[]) => mockCreateEvent(...args),
    deleteEvent: (...args: any[]) => mockDeleteEvent(...args),
  },
}));

// Mock other services referenced by memoryService
vi.mock('../memoryHelpers', () => ({
  searchMemories: vi.fn().mockResolvedValue([]),
  getUserFacts: vi.fn().mockResolvedValue([]),
  storeUserFact: vi.fn().mockResolvedValue(true),
}));

vi.mock('../taskService', () => ({
  fetchTasks: vi.fn().mockResolvedValue([]),
  createTask: vi.fn().mockResolvedValue(true),
  toggleTask: vi.fn().mockResolvedValue(true),
  deleteTask: vi.fn().mockResolvedValue(true),
}));

// Mock characterFactsService
vi.mock('../characterFactsService', () => ({
  storeCharacterFact: vi.fn().mockResolvedValue(true),
}));

describe('memoryService', () => {
  const userId = 'test-user-id';
  const mockAccessToken = 'mock-access-token';
  const mockContext: ToolExecutionContext = {
    googleAccessToken: mockAccessToken,
    currentEvents: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calendar_action', () => {
    const validCreateArgs: ToolCallArgs['calendar_action'] = {
      action: 'create',
      summary: 'Test Event',
      start: '2025-12-16T14:00:00',
      end: '2025-12-16T15:00:00',
      timeZone: 'America/Chicago',
    };

    it('should create an event successfully with valid arguments', async () => {
      mockCreateEvent.mockResolvedValue({
        id: 'new-event-id',
        summary: 'Test Event',
        start: { dateTime: '2025-12-16T14:00:00' },
        end: { dateTime: '2025-12-16T15:00:00' },
      });

      const result = await executeMemoryTool('calendar_action', validCreateArgs, userId, mockContext);

      expect(mockCreateEvent).toHaveBeenCalledWith(mockAccessToken, expect.objectContaining({
        summary: 'Test Event',
        start: { dateTime: '2025-12-16T14:00:00', timeZone: 'America/Chicago' },
        end: { dateTime: '2025-12-16T15:00:00', timeZone: 'America/Chicago' },
      }));
      expect(result).toContain('✓ Created calendar event');
    });

    it('should fail if access token is missing', async () => {
      const result = await executeMemoryTool('calendar_action', validCreateArgs, userId, { ...mockContext, googleAccessToken: undefined });

      expect(mockCreateEvent).not.toHaveBeenCalled();
      expect(result).toContain('Error: Not connected to Google Calendar');
    });

    it('should fail if required create arguments are missing', async () => {
      const invalidArgs = { ...validCreateArgs, summary: undefined };
      // Cast to any to bypass type check for test
      const result = await executeMemoryTool('calendar_action', invalidArgs as any, userId, mockContext);

      expect(mockCreateEvent).not.toHaveBeenCalled();
      expect(result).toContain('Error: Calendar event requires summary, start, and end time');
    });

    it('should handle API errors gracefully during creation', async () => {
      mockCreateEvent.mockRejectedValue(new Error('API Error'));

      const result = await executeMemoryTool('calendar_action', validCreateArgs, userId, mockContext);

      expect(mockCreateEvent).toHaveBeenCalled();
      expect(result).toContain('Error creating calendar event: API Error');
    });

    it('should delete a single event by ID', async () => {
      mockDeleteEvent.mockResolvedValue(undefined);

      const deleteArgs: ToolCallArgs['calendar_action'] = {
        action: 'delete',
        event_id: 'event-123',
      };

      const result = await executeMemoryTool('calendar_action', deleteArgs, userId, mockContext);

      expect(mockDeleteEvent).toHaveBeenCalledWith(mockAccessToken, 'event-123');
      expect(result).toContain('✓ Deleted 1 calendar event(s)');
    });

     it('should delete multiple events by IDs', async () => {
      mockDeleteEvent.mockResolvedValue(undefined);

      const deleteArgs: ToolCallArgs['calendar_action'] = {
        action: 'delete',
        event_ids: ['event-1', 'event-2'],
      };

      const result = await executeMemoryTool('calendar_action', deleteArgs, userId, mockContext);

      expect(mockDeleteEvent).toHaveBeenCalledTimes(2);
      expect(mockDeleteEvent).toHaveBeenCalledWith(mockAccessToken, 'event-1');
      expect(mockDeleteEvent).toHaveBeenCalledWith(mockAccessToken, 'event-2');
      expect(result).toContain('✓ Deleted 2 calendar event(s)');
    });

    it('should delete all events provided in context', async () => {
      mockDeleteEvent.mockResolvedValue(undefined);
      
      const contextWithEvents: ToolExecutionContext = {
        googleAccessToken: mockAccessToken,
        currentEvents: [
          { id: 'ev1', summary: 'Event 1' },
          { id: 'ev2', summary: 'Event 2' },
        ],
      };

      const deleteArgs: ToolCallArgs['calendar_action'] = {
        action: 'delete',
        delete_all: true,
      };

      const result = await executeMemoryTool('calendar_action', deleteArgs, userId, contextWithEvents);

      expect(mockDeleteEvent).toHaveBeenCalledTimes(2);
      expect(mockDeleteEvent).toHaveBeenCalledWith(mockAccessToken, 'ev1');
      expect(mockDeleteEvent).toHaveBeenCalledWith(mockAccessToken, 'ev2');
      expect(result).toContain('✓ Deleted 2 calendar event(s)');
    });

    it('should default to America/Chicago usage if timeZone not provided', async () => {
      mockCreateEvent.mockResolvedValue({});
      const argsNoTz = { ...validCreateArgs, timeZone: undefined };
      
      await executeMemoryTool('calendar_action', argsNoTz, userId, mockContext);
      
      expect(mockCreateEvent).toHaveBeenCalledWith(mockAccessToken, expect.objectContaining({
        start: expect.objectContaining({ timeZone: 'America/Chicago' })
      }));
    });
  });

  describe('task_action', () => {
    let taskServiceMock: any;

    beforeEach(async () => {
       taskServiceMock = await import('../taskService');
    });

    it('should create a task', async () => {
      const args: ToolCallArgs['task_action'] = {
        action: 'create',
        task_text: 'Buy milk',
        priority: 'medium',
      };
      
      const result = await executeMemoryTool('task_action', args, userId);
      
      expect(taskServiceMock.createTask).toHaveBeenCalledWith(userId, 'Buy milk', 'medium');
      expect(result).toContain('✓ Created task: "Buy milk"');
    });

    it('should list tasks', async () => {
      taskServiceMock.fetchTasks.mockResolvedValue([
        { id: '1', text: 'Buy milk', completed: false, priority: 'medium' },
        { id: '2', text: 'Walk dog', completed: true, priority: 'low' },
      ]);

      const args: ToolCallArgs['task_action'] = { action: 'list' };
      const result = await executeMemoryTool('task_action', args, userId);

      expect(result).toContain('Pending:');
      expect(result).toContain('[ ] Buy milk (medium priority)');
      expect(result).toContain('Completed:');
      expect(result).toContain('[✓] Walk dog');
    });

    it('should complete a task', async () => {
      taskServiceMock.fetchTasks.mockResolvedValue([
         { id: '1', text: 'Buy milk', completed: false },
      ]);
      
      const args: ToolCallArgs['task_action'] = {
        action: 'complete',
        task_text: 'buy milk',
      };
      
      const result = await executeMemoryTool('task_action', args, userId);
      
      expect(taskServiceMock.toggleTask).toHaveBeenCalledWith('1', false);
      expect(result).toContain('✓ Completed task');
    });

    it('should fail to complete if task not found', async () => {
       taskServiceMock.fetchTasks.mockResolvedValue([]);
       
       const args: ToolCallArgs['task_action'] = {
         action: 'complete',
         task_text: 'nonexistent',
       };
       
       const result = await executeMemoryTool('task_action', args, userId);
       
       expect(result).toContain('Could not find a task matching');
    });

    it('should delete a task', async () => {
      taskServiceMock.fetchTasks.mockResolvedValue([
         { id: '1', text: 'Buy milk', completed: false },
      ]);

      const args: ToolCallArgs['task_action'] = {
        action: 'delete',
        task_text: 'buy milk',
      };

      const result = await executeMemoryTool('task_action', args, userId);

      expect(taskServiceMock.deleteTask).toHaveBeenCalledWith('1');
      expect(result).toContain('✓ Deleted task');
    });
  });

  describe('store_character_info', () => {
    let charFactsMock: any;
    
    beforeEach(async () => {
       charFactsMock = await import('../characterFactsService');
    });

    it('should store character fact successfully', async () => {
      const args: ToolCallArgs['store_character_info'] = {
        category: 'preference',
        key: 'laptop_name',
        value: 'Nova'
      };
      
      const result = await executeMemoryTool('store_character_info', args, userId);
      
      expect(charFactsMock.storeCharacterFact).toHaveBeenCalledWith(undefined, 'preference', 'laptop_name', 'Nova');
      expect(result).toContain('✓ Stored character fact');
    });
  });
});
