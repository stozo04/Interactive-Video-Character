import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OngoingThread } from '../ongoingThreads';

// Mock Supabase to avoid environment variable issues
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: [], error: null })),
      update: vi.fn(() => Promise.resolve({ data: [], error: null })),
      delete: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
  },
}));

// Import after mocks
import { buildProactiveThreadPrompt } from '../promptUtils';

describe('buildProactiveThreadPrompt', () => {
  it('should build prompt for user-related thread with bridging', () => {
    const thread: OngoingThread = {
      id: '1',
      theme: 'user_reflection',
      currentState: 'I keep thinking about what they said about their job',
      intensity: 0.7,
      lastMentioned: null,
      userRelated: true,
      userTrigger: 'I hate my job, it\'s so stressful',
      createdAt: Date.now(),
    };

    const prompt = buildProactiveThreadPrompt(thread);
    
    // Verify bridging instructions are present
    expect(prompt).toContain('BRIDGE');
    expect(prompt).toContain('question');
    expect(prompt).toMatch(/user-related|USER-RELATED/i);
    expect(prompt).toContain(thread.userTrigger!.slice(0, 150));
    expect(prompt).toContain(thread.currentState);
    
    // Verify it includes good examples
    expect(prompt).toContain('GOOD examples');
    
    // Verify it includes bad examples
    expect(prompt).toContain('BAD examples');
    
    // Verify it explicitly says to ask a question
    expect(prompt).toMatch(/question|invitation|ask/i);
  });

  it('should build prompt for autonomous thread with bridging', () => {
    const thread: OngoingThread = {
      id: '2',
      theme: 'creative_project',
      currentState: 'I watched this documentary about mushrooms',
      intensity: 0.8,
      lastMentioned: null,
      userRelated: false,
      createdAt: Date.now(),
    };

    const prompt = buildProactiveThreadPrompt(thread);
    
    // Verify bridging instructions
    expect(prompt).toContain('BRIDGE');
    expect(prompt).toContain('question');
    expect(prompt).toContain(thread.currentState);
    
    // Verify it warns against dead ends
    expect(prompt).toContain('dead end');
    expect(prompt).toContain('No question');
    
    // Verify it includes examples
    expect(prompt).toContain('GOOD examples');
    expect(prompt).toContain('BAD examples');
  });

  it('should handle thread without userTrigger gracefully', () => {
    const thread: OngoingThread = {
      id: '4',
      theme: 'creative_project',
      currentState: 'Working on a project',
      intensity: 0.7,
      lastMentioned: null,
      userRelated: false,
      createdAt: Date.now(),
    };

    const prompt = buildProactiveThreadPrompt(thread);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(0);
  });
});

