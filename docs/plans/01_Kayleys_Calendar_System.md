# Implementation Guide: Kayley's Own Life (Calendar System)

## Overview

This guide walks you through implementing a calendar system that gives Kayley her own schedule, events, and social life. Instead of just existing to respond to the user, Kayley will have client calls, friend hangouts, therapy appointments, and life events that affect her mood and availability.

## Why This Matters

Currently, Kayley's "life" is vague thoughts like "work is busy." With this system:
- "I have a client call at 3pm" (concrete, time-bound)
- "Going to Lena's on Saturday" (real plans with real people)
- Her schedule affects her energy and availability
- She has stories to share about what happened

---

## Step 1: Database Schema

### 1.1 Create the Relationships Table

Kayley's friends and family need to be real entities, not just names in her profile.

```sql
-- supabase/migrations/YYYYMMDD_create_kayley_relationships.sql

CREATE TABLE kayley_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Basic info
  name TEXT NOT NULL,                          -- "Lena", "Ethan", "Mom"
  relationship_type TEXT NOT NULL,             -- "best_friend", "brother", "parent", "friend", "colleague"

  -- How Kayley knows them (for natural references)
  how_they_met TEXT,                           -- "College roommate", "Through work"
  location TEXT,                               -- "Lives in Portland"

  -- Dynamic state
  current_dynamic TEXT DEFAULT 'good',         -- "good", "distant", "tension", "reconnecting"
  last_mentioned_at TIMESTAMP,                 -- When Kayley last talked about them
  last_event_with_at TIMESTAMP,                -- When they last hung out

  -- For story continuity
  recent_context TEXT,                         -- "We had a weird conversation last week"
  ongoing_situation TEXT,                      -- "Planning her birthday party"

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed with known relationships from character profile
INSERT INTO kayley_relationships (name, relationship_type, how_they_met, location) VALUES
  ('Lena', 'best_friend', 'College roommate', 'Portland'),
  ('Ethan', 'brother', 'Family', 'Arizona'),
  ('Mom', 'parent', 'Family', 'Arizona'),
  ('Dad', 'parent', 'Family', 'Arizona');
```

### 1.2 Create the Events Table

```sql
-- supabase/migrations/YYYYMMDD_create_kayley_events.sql

CREATE TABLE kayley_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event basics
  title TEXT NOT NULL,                         -- "Client call with Spark AI"
  event_type TEXT NOT NULL,                    -- "work", "social", "self_care", "life"
  description TEXT,                            -- Optional details

  -- Timing
  scheduled_for TIMESTAMP NOT NULL,
  duration_minutes INT DEFAULT 60,

  -- Related person (if social event)
  related_person_id UUID REFERENCES kayley_relationships(id),

  -- How she feels about it
  anticipation_mood TEXT DEFAULT 'neutral',    -- "excited", "nervous", "dreading", "neutral"

  -- For natural conversation
  mention_template TEXT,                       -- "I have a client thing at {time}"
  pre_event_thought TEXT,                      -- What she might say before

  -- After the event
  post_event_outcome TEXT,                     -- "went well", "was exhausting", "got cancelled"
  post_event_story TEXT,                       -- What happened (for sharing)

  -- Effects on her state
  energy_impact DECIMAL(3,2) DEFAULT 0,        -- -1.0 to 1.0
  social_battery_impact DECIMAL(3,2) DEFAULT 0,
  makes_unavailable BOOLEAN DEFAULT false,

  -- Status tracking
  status TEXT DEFAULT 'scheduled',             -- "scheduled", "in_progress", "completed", "cancelled"

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for efficient queries
CREATE INDEX idx_kayley_events_scheduled ON kayley_events(scheduled_for);
CREATE INDEX idx_kayley_events_status ON kayley_events(status);
```

### 1.3 Create Recurring Events Table

```sql
-- supabase/migrations/YYYYMMDD_create_kayley_recurring_events.sql

CREATE TABLE kayley_recurring_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Template info
  title TEXT NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT,

  -- Recurrence pattern
  day_of_week INT,                             -- 0=Sunday, 1=Monday, etc.
  preferred_time TIME,                         -- e.g., "10:00:00"
  frequency TEXT NOT NULL,                     -- "weekly", "biweekly", "monthly"

  -- Related person (if applicable)
  related_person_id UUID REFERENCES kayley_relationships(id),

  -- Default values for generated events
  default_duration_minutes INT DEFAULT 60,
  default_anticipation_mood TEXT DEFAULT 'neutral',
  default_energy_impact DECIMAL(3,2) DEFAULT 0,

  -- Generation tracking
  is_active BOOLEAN DEFAULT true,
  last_generated_at TIMESTAMP,

  -- Variation
  skip_probability DECIMAL(3,2) DEFAULT 0.1,   -- 10% chance to skip

  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed with Kayley's known recurring events
INSERT INTO kayley_recurring_events
  (title, event_type, day_of_week, preferred_time, frequency, default_anticipation_mood)
VALUES
  ('Therapy', 'self_care', 4, '10:00:00', 'weekly', 'neutral'),
  ('Mom FaceTime', 'social', 0, '19:00:00', 'weekly', 'neutral'),
  ('Pilates', 'self_care', 1, '07:00:00', 'weekly', 'neutral'),
  ('Pilates', 'self_care', 3, '07:00:00', 'weekly', 'neutral');
```

---

## Step 2: TypeScript Types

Create a new file for the calendar types:

```typescript
// src/services/kayleyCalendar/types.ts

export type EventType = 'work' | 'social' | 'self_care' | 'life';
export type AnticipationMood = 'excited' | 'nervous' | 'dreading' | 'neutral';
export type EventStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type RelationshipType = 'best_friend' | 'friend' | 'brother' | 'parent' | 'colleague' | 'acquaintance';
export type RelationshipDynamic = 'good' | 'distant' | 'tension' | 'reconnecting';

export interface KayleyRelationship {
  id: string;
  name: string;
  relationshipType: RelationshipType;
  howTheyMet?: string;
  location?: string;
  currentDynamic: RelationshipDynamic;
  lastMentionedAt?: Date;
  lastEventWithAt?: Date;
  recentContext?: string;
  ongoingSituation?: string;
}

export interface KayleyEvent {
  id: string;
  title: string;
  eventType: EventType;
  description?: string;

  // Timing
  scheduledFor: Date;
  durationMinutes: number;

  // Related person
  relatedPersonId?: string;
  relatedPerson?: KayleyRelationship;  // Joined data

  // Emotional context
  anticipationMood: AnticipationMood;
  mentionTemplate?: string;
  preEventThought?: string;

  // After event
  postEventOutcome?: string;
  postEventStory?: string;

  // Effects
  energyImpact: number;
  socialBatteryImpact: number;
  makesUnavailable: boolean;

  // Status
  status: EventStatus;
}

export interface RecurringEvent {
  id: string;
  title: string;
  eventType: EventType;
  dayOfWeek: number;
  preferredTime: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  relatedPersonId?: string;
  defaultDurationMinutes: number;
  defaultAnticipationMood: AnticipationMood;
  defaultEnergyImpact: number;
  isActive: boolean;
  skipProbability: number;
}
```

---

## Step 3: Calendar Service

```typescript
// src/services/kayleyCalendar/calendarService.ts

import { supabase } from '../supabaseClient';
import type {
  KayleyEvent,
  KayleyRelationship,
  RecurringEvent,
  EventType,
  AnticipationMood
} from './types';

// Cache for performance
let eventsCache: { data: KayleyEvent[]; fetchedAt: number } | null = null;
let relationshipsCache: { data: KayleyRelationship[]; fetchedAt: number } | null = null;
const CACHE_TTL = 60000; // 1 minute

/**
 * Get all of Kayley's relationships
 */
export async function getRelationships(): Promise<KayleyRelationship[]> {
  // Check cache
  if (relationshipsCache && Date.now() - relationshipsCache.fetchedAt < CACHE_TTL) {
    return relationshipsCache.data;
  }

  const { data, error } = await supabase
    .from('kayley_relationships')
    .select('*')
    .order('name');

  if (error) {
    console.error('[KayleyCalendar] Error fetching relationships:', error);
    return [];
  }

  const relationships = data.map(mapRelationshipFromDb);
  relationshipsCache = { data: relationships, fetchedAt: Date.now() };
  return relationships;
}

/**
 * Get a specific relationship by name
 */
export async function getRelationshipByName(name: string): Promise<KayleyRelationship | null> {
  const relationships = await getRelationships();
  return relationships.find(r => r.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Get Kayley's events for a time range
 */
export async function getEvents(
  startDate: Date = new Date(),
  endDate?: Date
): Promise<KayleyEvent[]> {
  const end = endDate || new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // Default: 1 week

  const { data, error } = await supabase
    .from('kayley_events')
    .select(`
      *,
      related_person:kayley_relationships(*)
    `)
    .gte('scheduled_for', startDate.toISOString())
    .lte('scheduled_for', end.toISOString())
    .order('scheduled_for');

  if (error) {
    console.error('[KayleyCalendar] Error fetching events:', error);
    return [];
  }

  return data.map(mapEventFromDb);
}

/**
 * Get today's events
 */
export async function getTodaysEvents(): Promise<KayleyEvent[]> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  return getEvents(startOfDay, endOfDay);
}

/**
 * Get the next upcoming event
 */
export async function getNextEvent(): Promise<KayleyEvent | null> {
  const { data, error } = await supabase
    .from('kayley_events')
    .select(`
      *,
      related_person:kayley_relationships(*)
    `)
    .gte('scheduled_for', new Date().toISOString())
    .eq('status', 'scheduled')
    .order('scheduled_for')
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return mapEventFromDb(data);
}

/**
 * Check if Kayley is currently in an event
 */
export async function getCurrentEvent(): Promise<KayleyEvent | null> {
  const now = new Date();

  const { data, error } = await supabase
    .from('kayley_events')
    .select(`
      *,
      related_person:kayley_relationships(*)
    `)
    .lte('scheduled_for', now.toISOString())
    .eq('status', 'in_progress')
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return mapEventFromDb(data);
}

/**
 * Create a new event
 */
export async function createEvent(event: Omit<KayleyEvent, 'id'>): Promise<KayleyEvent> {
  const { data, error } = await supabase
    .from('kayley_events')
    .insert(mapEventToDb(event))
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create event: ${error.message}`);
  }

  // Clear cache
  eventsCache = null;

  return mapEventFromDb(data);
}

/**
 * Update an event's status
 */
export async function updateEventStatus(
  eventId: string,
  status: 'in_progress' | 'completed' | 'cancelled',
  outcome?: string,
  story?: string
): Promise<void> {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString()
  };

  if (outcome) updates.post_event_outcome = outcome;
  if (story) updates.post_event_story = story;

  const { error } = await supabase
    .from('kayley_events')
    .update(updates)
    .eq('id', eventId);

  if (error) {
    throw new Error(`Failed to update event: ${error.message}`);
  }

  // Clear cache
  eventsCache = null;
}

/**
 * Generate events from recurring templates
 * Call this daily (e.g., via cron job or on app startup)
 */
export async function generateRecurringEvents(): Promise<number> {
  // Get active recurring events
  const { data: templates, error } = await supabase
    .from('kayley_recurring_events')
    .select('*')
    .eq('is_active', true);

  if (error || !templates) {
    console.error('[KayleyCalendar] Error fetching recurring templates:', error);
    return 0;
  }

  let generatedCount = 0;
  const now = new Date();
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  for (const template of templates) {
    // Check if we should skip this occurrence (randomness)
    if (Math.random() < template.skip_probability) {
      continue;
    }

    // Find the next occurrence
    const nextOccurrence = getNextOccurrence(template, now);

    if (nextOccurrence && nextOccurrence <= oneWeekFromNow) {
      // Check if event already exists for this time
      const existing = await checkEventExists(template.title, nextOccurrence);

      if (!existing) {
        await createEvent({
          title: template.title,
          eventType: template.event_type,
          scheduledFor: nextOccurrence,
          durationMinutes: template.default_duration_minutes,
          relatedPersonId: template.related_person_id,
          anticipationMood: template.default_anticipation_mood,
          energyImpact: template.default_energy_impact,
          socialBatteryImpact: 0,
          makesUnavailable: false,
          status: 'scheduled'
        });
        generatedCount++;
      }
    }

    // Update last generated timestamp
    await supabase
      .from('kayley_recurring_events')
      .update({ last_generated_at: now.toISOString() })
      .eq('id', template.id);
  }

  console.log(`[KayleyCalendar] Generated ${generatedCount} events from recurring templates`);
  return generatedCount;
}

// Helper: Get next occurrence of a recurring event
function getNextOccurrence(template: RecurringEvent, after: Date): Date | null {
  const result = new Date(after);

  // Set to the preferred time
  const [hours, minutes] = template.preferredTime.split(':').map(Number);
  result.setHours(hours, minutes, 0, 0);

  // Find the next matching day of week
  while (result.getDay() !== template.dayOfWeek || result <= after) {
    result.setDate(result.getDate() + 1);
  }

  return result;
}

// Helper: Check if event already exists
async function checkEventExists(title: string, scheduledFor: Date): Promise<boolean> {
  const startOfDay = new Date(scheduledFor);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(scheduledFor);
  endOfDay.setHours(23, 59, 59, 999);

  const { count } = await supabase
    .from('kayley_events')
    .select('*', { count: 'exact', head: true })
    .eq('title', title)
    .gte('scheduled_for', startOfDay.toISOString())
    .lte('scheduled_for', endOfDay.toISOString());

  return (count || 0) > 0;
}

// Helper: Map database row to TypeScript type
function mapEventFromDb(row: Record<string, unknown>): KayleyEvent {
  return {
    id: row.id as string,
    title: row.title as string,
    eventType: row.event_type as EventType,
    description: row.description as string | undefined,
    scheduledFor: new Date(row.scheduled_for as string),
    durationMinutes: row.duration_minutes as number,
    relatedPersonId: row.related_person_id as string | undefined,
    relatedPerson: row.related_person ? mapRelationshipFromDb(row.related_person) : undefined,
    anticipationMood: row.anticipation_mood as AnticipationMood,
    mentionTemplate: row.mention_template as string | undefined,
    preEventThought: row.pre_event_thought as string | undefined,
    postEventOutcome: row.post_event_outcome as string | undefined,
    postEventStory: row.post_event_story as string | undefined,
    energyImpact: Number(row.energy_impact),
    socialBatteryImpact: Number(row.social_battery_impact),
    makesUnavailable: row.makes_unavailable as boolean,
    status: row.status as EventStatus
  };
}

function mapRelationshipFromDb(row: Record<string, unknown>): KayleyRelationship {
  return {
    id: row.id as string,
    name: row.name as string,
    relationshipType: row.relationship_type as RelationshipType,
    howTheyMet: row.how_they_met as string | undefined,
    location: row.location as string | undefined,
    currentDynamic: row.current_dynamic as RelationshipDynamic,
    lastMentionedAt: row.last_mentioned_at ? new Date(row.last_mentioned_at as string) : undefined,
    lastEventWithAt: row.last_event_with_at ? new Date(row.last_event_with_at as string) : undefined,
    recentContext: row.recent_context as string | undefined,
    ongoingSituation: row.ongoing_situation as string | undefined
  };
}

function mapEventToDb(event: Omit<KayleyEvent, 'id'>): Record<string, unknown> {
  return {
    title: event.title,
    event_type: event.eventType,
    description: event.description,
    scheduled_for: event.scheduledFor.toISOString(),
    duration_minutes: event.durationMinutes,
    related_person_id: event.relatedPersonId,
    anticipation_mood: event.anticipationMood,
    mention_template: event.mentionTemplate,
    pre_event_thought: event.preEventThought,
    energy_impact: event.energyImpact,
    social_battery_impact: event.socialBatteryImpact,
    makes_unavailable: event.makesUnavailable,
    status: event.status
  };
}
```

---

## Step 4: Calendar Context Builder

This creates the prompt context for Kayley's calendar awareness:

```typescript
// src/services/kayleyCalendar/calendarContextBuilder.ts

import {
  getTodaysEvents,
  getNextEvent,
  getCurrentEvent,
  getRelationships
} from './calendarService';
import type { KayleyEvent, KayleyRelationship } from './types';

export interface CalendarContext {
  currentEvent: KayleyEvent | null;
  upcomingToday: KayleyEvent[];
  nextEvent: KayleyEvent | null;
  recentlyCompleted: KayleyEvent[];
  promptSection: string;
}

/**
 * Build calendar context for the system prompt
 */
export async function buildCalendarContext(): Promise<CalendarContext> {
  const [todaysEvents, nextEvent, currentEvent] = await Promise.all([
    getTodaysEvents(),
    getNextEvent(),
    getCurrentEvent()
  ]);

  const now = new Date();

  // Filter events
  const upcomingToday = todaysEvents.filter(e =>
    e.status === 'scheduled' && new Date(e.scheduledFor) > now
  );

  const recentlyCompleted = todaysEvents.filter(e =>
    e.status === 'completed' &&
    (now.getTime() - new Date(e.scheduledFor).getTime()) < 4 * 60 * 60 * 1000 // Last 4 hours
  );

  // Build prompt section
  const promptSection = buildPromptSection(currentEvent, upcomingToday, recentlyCompleted, nextEvent);

  return {
    currentEvent,
    upcomingToday,
    nextEvent,
    recentlyCompleted,
    promptSection
  };
}

function buildPromptSection(
  currentEvent: KayleyEvent | null,
  upcomingToday: KayleyEvent[],
  recentlyCompleted: KayleyEvent[],
  nextEvent: KayleyEvent | null
): string {
  const lines: string[] = [];

  lines.push(`
====================================================
📅 YOUR SCHEDULE (Kayley's Calendar)
====================================================
`);

  // Currently in an event
  if (currentEvent) {
    lines.push(`🔴 RIGHT NOW: You're in "${currentEvent.title}"`);
    lines.push(`   - You might be distracted or unavailable`);
    lines.push(`   - If responding, keep it brief: "Sorry, in the middle of something"`);
    lines.push('');
  }

  // Upcoming today
  if (upcomingToday.length > 0) {
    lines.push('COMING UP TODAY:');
    for (const event of upcomingToday.slice(0, 3)) {
      const time = formatTime(event.scheduledFor);
      const mood = event.anticipationMood !== 'neutral' ? ` (${event.anticipationMood})` : '';
      const person = event.relatedPerson ? ` with ${event.relatedPerson.name}` : '';
      lines.push(`- ${time}: ${event.title}${person}${mood}`);
    }
    lines.push('');
  }

  // Recently completed (stories to share)
  if (recentlyCompleted.length > 0) {
    lines.push('RECENTLY FINISHED (you can share about these):');
    for (const event of recentlyCompleted) {
      const outcome = event.postEventOutcome ? ` - ${event.postEventOutcome}` : '';
      lines.push(`- ${event.title}${outcome}`);
      if (event.postEventStory) {
        lines.push(`  Story: "${event.postEventStory}"`);
      }
    }
    lines.push('');
  }

  // Next event context
  if (nextEvent && !currentEvent) {
    const hoursUntil = (new Date(nextEvent.scheduledFor).getTime() - Date.now()) / (1000 * 60 * 60);

    if (hoursUntil < 1) {
      lines.push(`⏰ HEADS UP: "${nextEvent.title}" is in less than an hour`);
      lines.push(`   - You might mention needing to wrap up soon`);
    } else if (hoursUntil < 3) {
      lines.push(`📌 LATER: "${nextEvent.title}" at ${formatTime(nextEvent.scheduledFor)}`);
    }
    lines.push('');
  }

  // Guidance
  lines.push(`HOW TO USE THIS:
- You can mention upcoming events naturally: "I have a thing at 3"
- After events, you can share stories: "Okay so that call was wild"
- Events affect your energy - use this to inform your mood
- Don't force it - only mention if it's natural
`);

  return lines.join('\n');
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}
```

---

## Step 5: Integration with Mood System

Update mood knobs to consider calendar events:

```typescript
// src/services/kayleyCalendar/moodIntegration.ts

import { getTodaysEvents, getCurrentEvent } from './calendarService';
import type { MoodKnobs } from '../moodKnobs';

/**
 * Apply calendar-based mood modifications
 */
export async function applyCalendarMoodEffects(
  baseMood: MoodKnobs
): Promise<MoodKnobs> {
  const todaysEvents = await getTodaysEvents();
  const currentEvent = await getCurrentEvent();

  let energyModifier = 0;
  let socialBatteryModifier = 0;

  // Currently in event
  if (currentEvent) {
    energyModifier -= 0.1; // Slightly lower energy (distracted)
    if (currentEvent.makesUnavailable) {
      // They shouldn't even be chatting, but if they are, be brief
      baseMood.verbosity = Math.max(0.2, baseMood.verbosity - 0.3);
    }
  }

  // Sum up completed events' impact
  const completed = todaysEvents.filter(e => e.status === 'completed');
  for (const event of completed) {
    energyModifier += event.energyImpact;
    socialBatteryModifier += event.socialBatteryImpact;
  }

  // Check for upcoming stressful events
  const upcoming = todaysEvents.filter(e => e.status === 'scheduled');
  const hasUpcomingNervous = upcoming.some(e => e.anticipationMood === 'nervous');
  const hasUpcomingDreading = upcoming.some(e => e.anticipationMood === 'dreading');

  if (hasUpcomingDreading) {
    energyModifier -= 0.15;
  } else if (hasUpcomingNervous) {
    energyModifier -= 0.05;
  }

  // Apply modifiers (clamped)
  const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));

  return {
    ...baseMood,
    verbosity: clamp(baseMood.verbosity + (energyModifier * 0.2), 0.2, 1.0),
    initiationRate: clamp(baseMood.initiationRate + (energyModifier * 0.1), 0.1, 0.8)
  };
}
```

---

## Step 6: System Prompt Integration

Add the calendar context to the system prompt builder:

```typescript
// In src/services/system_prompts/builders/systemPromptBuilder.ts

import { buildCalendarContext } from '../../kayleyCalendar/calendarContextBuilder';

// In the buildSystemPrompt function, add:
const calendarContext = await buildCalendarContext();

// Add to the prompt:
prompt += calendarContext.promptSection;
```

---

## Step 7: Event Lifecycle Management

Create a service to manage event state transitions:

```typescript
// src/services/kayleyCalendar/eventLifecycle.ts

import { updateEventStatus, getTodaysEvents, getCurrentEvent } from './calendarService';

/**
 * Check and update event statuses based on time
 * Call this periodically (e.g., every 5 minutes)
 */
export async function updateEventLifecycles(): Promise<void> {
  const now = new Date();
  const events = await getTodaysEvents();

  for (const event of events) {
    const eventStart = new Date(event.scheduledFor);
    const eventEnd = new Date(eventStart.getTime() + event.durationMinutes * 60 * 1000);

    if (event.status === 'scheduled') {
      // Event should start
      if (now >= eventStart && now < eventEnd) {
        await updateEventStatus(event.id, 'in_progress');
        console.log(`[EventLifecycle] Started: ${event.title}`);
      }
    } else if (event.status === 'in_progress') {
      // Event should complete
      if (now >= eventEnd) {
        // Generate a simple outcome (in production, could use LLM)
        const outcome = generateSimpleOutcome(event);
        await updateEventStatus(event.id, 'completed', outcome);
        console.log(`[EventLifecycle] Completed: ${event.title}`);
      }
    }
  }
}

function generateSimpleOutcome(event: KayleyEvent): string {
  const outcomes: Record<string, string[]> = {
    work: ['went well', 'was productive', 'was a lot', 'was fine'],
    social: ['was so fun', 'was nice', 'was good catching up', 'was a bit much'],
    self_care: ['helped', 'was needed', 'was good', 'was tough but good'],
    life: ['done', 'checked off', 'handled', 'finally done']
  };

  const options = outcomes[event.eventType] || ['done'];
  return options[Math.floor(Math.random() * options.length)];
}
```

---

## Step 8: Testing

```typescript
// src/services/kayleyCalendar/__tests__/calendarService.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRelationships,
  createEvent,
  getTodaysEvents
} from '../calendarService';

describe('KayleyCalendarService', () => {
  describe('getRelationships', () => {
    it('should return seeded relationships', async () => {
      const relationships = await getRelationships();

      expect(relationships.length).toBeGreaterThan(0);
      expect(relationships.some(r => r.name === 'Lena')).toBe(true);
    });
  });

  describe('createEvent', () => {
    it('should create and return an event', async () => {
      const event = await createEvent({
        title: 'Test Client Call',
        eventType: 'work',
        scheduledFor: new Date(),
        durationMinutes: 60,
        anticipationMood: 'neutral',
        energyImpact: -0.1,
        socialBatteryImpact: -0.1,
        makesUnavailable: false,
        status: 'scheduled'
      });

      expect(event.id).toBeDefined();
      expect(event.title).toBe('Test Client Call');
    });
  });
});
```

---

## Summary

You've now implemented:

1. **Database tables** for relationships, events, and recurring events
2. **TypeScript types** for type safety
3. **Calendar service** for CRUD operations
4. **Context builder** for system prompt integration
5. **Mood integration** to affect Kayley's state
6. **Event lifecycle** management
7. **Tests** to verify functionality

### Next Steps

1. Run migrations to create the database tables
2. Seed the recurring events
3. Set up a cron job to call `generateRecurringEvents()` daily
4. Set up a timer to call `updateEventLifecycles()` every 5 minutes
5. Integrate `buildCalendarContext()` into your system prompt builder
