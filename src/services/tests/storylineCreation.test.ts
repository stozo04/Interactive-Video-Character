// src/services/tests/storylineCreation.test.ts
/**
 * Tests for storyline creation (Phase 1: Conversation-Driven Creation)
 *
 * Tests safety checks, cooldown, deduplication, category constraints,
 * and audit logging.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createStorylineFromTool,
  type CreateStorylineFromToolInput,
  getActiveStorylines,
  deleteStoryline,
} from '../storylineService';
import { supabase } from '../supabaseClient';

describe('Storyline Creation (Phase 1)', () => {

  // Clean up test data after each test
  afterEach(async () => {
    // Delete all test storylines
    const active = await getActiveStorylines();
    for (const storyline of active) {
      await deleteStoryline(storyline.id);
    }

    // Reset cooldown timestamp (set to 49 hours ago = outside cooldown)
    const { error } = await supabase
      .from('storyline_config')
      .update({ last_storyline_created_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString() })
      .eq('id', 1);

    if (error) {
      console.error('Failed to reset cooldown:', error);
    }
  });

  describe('Happy Path', () => {
    it('should successfully create a valid storyline', async () => {
      const input: CreateStorylineFromToolInput = {
        title: 'Learning guitar',
        category: 'creative',
        storylineType: 'project',
        initialAnnouncement: "I'm starting guitar lessons next week!",
        stakes: "I've wanted to learn music for years and this feels like the right time",
        emotionalTone: 'excited',
        emotionalIntensity: 0.7,
      };

      const result = await createStorylineFromTool(input);

      expect(result.success).toBe(true);
      expect(result.storylineId).toBeDefined();
      expect(result.error).toBeUndefined();

      // Verify storyline exists in database
      const active = await getActiveStorylines();
      expect(active.length).toBe(1);
      expect(active[0].title).toBe('Learning guitar');
      expect(active[0].category).toBe('creative');
    });

    it('should set user involvement correctly', async () => {
      const input: CreateStorylineFromToolInput = {
        title: 'Theater audition',
        category: 'creative',
        storylineType: 'opportunity',
        initialAnnouncement: "I'm auditioning for a play",
        stakes: "Haven't done theater since high school",
        userInvolvement: 'supportive',
      };

      const result = await createStorylineFromTool(input);
      expect(result.success).toBe(true);

      const active = await getActiveStorylines();
      expect(active[0].userInvolvement).toBe('supportive');
    });
  });

  describe('Safety Check: Cooldown', () => {
    it('should reject creation within 48-hour cooldown window', async () => {
      // Create first storyline
      const first: CreateStorylineFromToolInput = {
        title: 'First storyline',
        category: 'personal',
        storylineType: 'goal',
        initialAnnouncement: 'Starting a new goal',
        stakes: 'This matters to me',
      };

      const firstResult = await createStorylineFromTool(first);
      expect(firstResult.success).toBe(true);

      // Delete it to allow second creation (category constraint)
      await deleteStoryline(firstResult.storylineId!);

      // Try to create second storyline immediately (should fail cooldown)
      const second: CreateStorylineFromToolInput = {
        title: 'Second storyline',
        category: 'work',
        storylineType: 'project',
        initialAnnouncement: 'Starting work project',
        stakes: 'Career advancement',
      };

      const secondResult = await createStorylineFromTool(second);

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain('wait');
      expect(secondResult.error).toContain('hours');
      expect(secondResult.errorDetails?.reason).toBe('cooldown');
      expect(secondResult.errorDetails?.hoursRemaining).toBeDefined();
    });
  });

  describe('Safety Check: Duplicate Detection', () => {
    it('should detect duplicate storylines with high similarity', async () => {
      // Create first storyline
      const first: CreateStorylineFromToolInput = {
        title: 'Learning to play guitar',
        category: 'creative',
        storylineType: 'project',
        initialAnnouncement: 'Starting guitar lessons',
        stakes: 'Want to learn music',
      };

      const firstResult = await createStorylineFromTool(first);
      expect(firstResult.success).toBe(true);

      // Delete to bypass category constraint
      await deleteStoryline(firstResult.storylineId!);

      // Reset cooldown
      await supabase
        .from('storyline_config')
        .update({ last_storyline_created_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString() })
        .eq('id', 1);

      // Try to create very similar storyline (should fail duplicate check)
      const duplicate: CreateStorylineFromToolInput = {
        title: 'Learning guitar playing',
        category: 'creative',
        storylineType: 'project',
        initialAnnouncement: 'Taking guitar classes',
        stakes: 'Love music',
      };

      const duplicateResult = await createStorylineFromTool(duplicate);

      expect(duplicateResult.success).toBe(false);
      expect(duplicateResult.error).toContain('similar');
      expect(duplicateResult.errorDetails?.reason).toBe('duplicate');
    });

    it('should allow different storylines in same category', async () => {
      const first: CreateStorylineFromToolInput = {
        title: 'Learning guitar',
        category: 'creative',
        storylineType: 'project',
        initialAnnouncement: 'Starting guitar lessons',
        stakes: 'Music is life',
      };

      const firstResult = await createStorylineFromTool(first);
      expect(firstResult.success).toBe(true);

      // Delete for category constraint
      await deleteStoryline(firstResult.storylineId!);

      // Reset cooldown
      await supabase
        .from('storyline_config')
        .update({ last_storyline_created_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString() })
        .eq('id', 1);

      // Create different storyline (should succeed - not duplicate)
      const different: CreateStorylineFromToolInput = {
        title: 'Auditioning for theater',
        category: 'creative',
        storylineType: 'opportunity',
        initialAnnouncement: 'Got invited to audition',
        stakes: 'Love performing',
      };

      const differentResult = await createStorylineFromTool(different);
      expect(differentResult.success).toBe(true);
    });
  });

  describe('Safety Check: Category Constraint (Phase 1)', () => {
    it('should reject creation when active storyline exists', async () => {
      // Create first storyline
      const first: CreateStorylineFromToolInput = {
        title: 'Learning guitar',
        category: 'creative',
        storylineType: 'project',
        initialAnnouncement: 'Starting lessons',
        stakes: 'Music dreams',
      };

      const firstResult = await createStorylineFromTool(first);
      expect(firstResult.success).toBe(true);

      // Reset cooldown to allow second attempt
      await supabase
        .from('storyline_config')
        .update({ last_storyline_created_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString() })
        .eq('id', 1);

      // Try to create second storyline (should fail - active exists)
      const second: CreateStorylineFromToolInput = {
        title: 'Starting a blog',
        category: 'work',
        storylineType: 'project',
        initialAnnouncement: 'Launching blog',
        stakes: 'Career building',
      };

      const secondResult = await createStorylineFromTool(second);

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain('active storyline');
      expect(secondResult.error).toContain('Learning guitar');
      expect(secondResult.errorDetails?.reason).toBe('category_blocked');
      expect(secondResult.errorDetails?.activeStorylineTitle).toBe('Learning guitar');
    });
  });

  describe('Audit Logging', () => {
    it('should log successful creation attempts', async () => {
      const input: CreateStorylineFromToolInput = {
        title: 'Test storyline',
        category: 'personal',
        storylineType: 'goal',
        initialAnnouncement: 'Test',
        stakes: 'Test stakes',
      };

      await createStorylineFromTool(input);

      // Check audit log
      const { data, error } = await supabase
        .from('storyline_creation_attempts')
        .select('*')
        .eq('title', 'Test storyline')
        .order('attempted_at', { ascending: false })
        .limit(1);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.length).toBe(1);
      expect(data![0].success).toBe(true);
      expect(data![0].failure_reason).toBeNull();
    });

    it('should log failed creation attempts with reason', async () => {
      // Create first to trigger cooldown
      const first: CreateStorylineFromToolInput = {
        title: 'First',
        category: 'work',
        storylineType: 'project',
        initialAnnouncement: 'Test',
        stakes: 'Test',
      };
      await createStorylineFromTool(first);
      await deleteStoryline((await getActiveStorylines())[0].id);

      // Try second (should fail cooldown)
      const second: CreateStorylineFromToolInput = {
        title: 'Second',
        category: 'work',
        storylineType: 'project',
        initialAnnouncement: 'Test 2',
        stakes: 'Test 2',
      };
      await createStorylineFromTool(second);

      // Check audit log for failure
      const { data, error } = await supabase
        .from('storyline_creation_attempts')
        .select('*')
        .eq('title', 'Second')
        .order('attempted_at', { ascending: false })
        .limit(1);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.length).toBe(1);
      expect(data![0].success).toBe(false);
      expect(data![0].failure_reason).toBe('cooldown_active');
      expect(data![0].cooldown_hours_remaining).toBeGreaterThan(0);
    });
  });
});
