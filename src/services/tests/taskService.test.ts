
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as taskService from '../taskService';
import { supabase } from '../supabaseClient';

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  },
}));

describe('taskService', () => {
  const mockTasks = [
    {
      id: '1',
      user_id: 'user-123',
      text: 'Test task',
      completed: false,
      priority: 'low',
      created_at: new Date().toISOString(),
      scheduled_date: new Date().toISOString().split('T')[0]
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchTasks", () => {
    it("should fetch tasks for a user", async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          or: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: mockTasks, error: null }),
          }),
        }),
      });

      (supabase.from as any).mockReturnValue({ select: selectMock });

      const tasks = await taskService.fetchTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].text).toBe("Test task");
      expect(tasks[0].scheduledDate).toBeDefined();
      expect(selectMock).toHaveBeenCalledWith("*");
    });
  });

  describe("createTask", () => {
    it("should create a task", async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi
            .fn()
            .mockResolvedValue({ data: mockTasks[0], error: null }),
        }),
      });

      (supabase.from as any).mockReturnValue({ insert: insertMock });

      const task = await taskService.createTask("Test task", "low");

      expect(task).toEqual(
        expect.objectContaining({
          text: "Test task",
          priority: "low",
          scheduledDate: expect.any(String),
        })
      );
    });
  });

  describe('toggleTask', () => {
    it('should toggle task completion', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ 
              data: { ...mockTasks[0], completed: true }, 
              error: null 
            })
          })
        })
      });

      (supabase.from as any).mockReturnValue({ update: updateMock });

      const task = await taskService.toggleTask('1', false);
      
      expect(task?.completed).toBe(true);
    });
  });

  describe('deleteTask', () => {
    it('should delete a task', async () => {
      const deleteMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      });

      (supabase.from as any).mockReturnValue({ delete: deleteMock });

      const success = await taskService.deleteTask('1');
      
      expect(success).toBe(true);
    });
  });
});
