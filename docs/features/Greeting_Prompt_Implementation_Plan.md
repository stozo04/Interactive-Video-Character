# Greeting Prompt Implementation Plan

**Goal:** Create a lean, focused `buildSystemPromptForGreeting` that is optimized for the "start of day" experience, distinct from `buildSystemPromptForNonGreeting` (returning to a conversation).

## Current State

Both `buildSystemPromptForGreeting` and `buildSystemPromptForNonGreeting` are identical (~1040 lines). The greeting prompt should be significantly leaner with greeting-specific context.

---

## Sections to KEEP in Greeting Prompt

| Section | Why Keep |
|---------|----------|
| `buildIdentityAnchorSection` + `buildAntiAssistantSection` | Core identity - always needed |
| `KAYLEY_CONDENSED_PROFILE` | Character foundation |
| `buildRelationshipTierPrompt` | Tier-appropriate greeting behavior |
| `upcomingEvents` (Calendar section) | Present/Future events for the day |
| `DAILY CHECKLIST CONTEXT` | High-priority tasks with age awareness |
| `buildOutputFormatSection` | JSON schema for response |
| `buildCriticalOutputRulesSection` | Must be at end (recency bias) |
| `buildToolsSection` / `buildToolRulesSection` | Needed for task_action + websearch tools |

---

## Sections to REMOVE from Greeting Prompt

| Section | Why Remove |
|---------|------------|
| `buildCuriosityEngagementSection` | Not needed for initial greeting |
| `buildStyleOutputSection` | Simplify for greeting |
| `formatMoodForPrompt` | Kayley's mood less relevant in greeting |
| `buildBidDetectionPrompt` | No bids to detect in greeting |
| `buildSelectiveAttentionPrompt` | No multi-topic user message yet |
| `buildComfortableImperfectionPrompt` | Mid-conversation guidance |
| `buildPresencePrompt` | Mid-conversation presence |
| `PATTERN INSIGHTS` | Relationship insight is for mid-conversation |
| `buildSelfKnowledgeSection` | Self-knowledge lookup not needed for greeting |
| Storyline injection | Not for greeting (message #0) |
| `promisesContext` | Replaced by open loops in greeting context |
| `formatExperiencesForPrompt` | Kayley's life experiences (mid-conversation) |
| `spontaneityIntegration` | Spontaneous selfies etc. (mid-conversation) |
| `PROACTIVE CONVERSATION STARTERS` | Greeting IS the proactive start |
| `PENDING MESSAGE CONTEXT` | Keep greeting simple - no pending messages |
| `callbackPrompt` | Callbacks are for mid-conversation |
| `INTIMACY & EARNED CLOSENESS` | Flirting guidance (mid-conversation) |
| `almostMomentsPrompt` | Romantic escalation (mid-conversation) |
| `YOUR CURRENT CONTEXT` | Replaced by greeting-specific context |

---

## NEW Sections for Greeting Prompt

### 1. Time of Day Awareness

```
Early (<8am): Concerned tone - "You're up early, everything okay?"
Normal (8am-8pm): Standard greeting - "Hey! Good to see you"
Late (>11am): Sarcastic tone - "Hey, Look who showed up!"
```

**Implementation:** `buildTimeOfDayContext()` in `src/services/system_prompts/greeting/timeOfDay.ts`

### 2. Important Dates Detection

Query `user_facts` for date-type facts (birthdays, anniversaries) that match today or are within a few days.

**Storage Enhancement:** Add `fact_type: 'date'` category to user_facts. Example:
```sql
-- Stored as: fact_text = "July 1st", category = "birthday"
-- Or: fact_text = "2024-07-01", category = "important_date", metadata = {label: "User's birthday"}
```

**Implementation:**
- Enhance `user_facts` to support date facts
- `getUpcomingImportantDates()` in `src/services/memoryService.ts`
- `buildImportantDatesContext()` in greeting builder
- Update `buildToolsSection()` in `src\services\system_prompts\tools\toolsAndCapabilities.ts`

### 3. Holiday Awareness

Check if today is a major holiday (Christmas, Thanksgiving, etc.) or close to one.

**Implementation:** `buildHolidayContext()` with a static holiday list + logic

### 4. Past Calendar Context (Since Last Interaction)

Query calendar events between last interaction and now, so Kayley can follow up.

Example: "I noticed Christmas was a few days ago and we haven't talked since - how was it?"

**Implementation:**
1. Query `conversation_history` for last `created_at`
2. Query Google Calendar for events between then and now
3. `buildPastEventsContext()` injects this into prompt

### 5. Last Interaction Context

How long since last conversation? Affects greeting warmth.

```
<1 day: "Hey again!"
1-3 days: "Haven't talked in a bit"
>3 days: "It's been a minute!"
>1 week: "I've missed you!"
```

**Implementation:** `buildLastInteractionContext()` queries `conversation_history`

### 6. Open Loops / Follow-ups

Query pending promises and open loops that should be followed up on in greeting.

**Implementation:**
- Already have `buildPromisesContext()` - adapt for greeting
- `getOpenLoopsForGreeting()` returns time-sensitive follow-ups

### 7. Bidirectional Check-in Guidance

Greeting-specific instruction: Share what Kayley has been up to AND ask how user is feeling.
Kayley has her own life story that can be used in the database table:
- life_storylines
- storyline_updates

**Implementation:** `buildCheckInGuidance()` - static prompt section

### 8. High-Priority Task Age

Already tracked via `created_at`. Surface age for high-priority pending tasks.

Example: "That interview prep has been on your list for 3 days now"

**Implementation:** Enhance `DAILY CHECKLIST CONTEXT` to include task age for high-priority items

### 9. Global News Context (Websearch)

Kayley has websearch capability and should proactively search for major news during greeting.
Note: This is built in with Gemini and not a application specific feature.. Maybe just let
Kayley know she has the ability to search the web

**Threshold - "Significant Events":**
- World-changing: War declarations, major disasters, historic elections
- Significant: Major company failures, notable celebrity deaths, big sports finals
- NOT included: Minor local news, entertainment gossip, routine politics

**Implementation:**
- Greeting prompt includes guidance to use websearch tool for "major news since [last interaction]"
- Kayley uses judgment to filter for significance
- Results mentioned naturally: "Did you hear about [major event]?" or "I saw [event] happened..."

**Guidance for Kayley:**
```
When greeting, consider searching for major global news that happened since we last talked.
Only mention truly significant events - things that would be front-page news or that
everyone is talking about. Don't overwhelm with minor stories.
```

---

## Implementation Steps

### Phase 1: Create Greeting Module Structure

1. Create `src/services/system_prompts/greeting/` folder
2. Create individual builder files:
   - `timeOfDay.ts`
   - `importantDates.ts`
   - `holidayContext.ts`
   - `pastEventsContext.ts`
   - `lastInteraction.ts`
   - `checkInGuidance.ts`
   - `index.ts` (barrel export)

### Phase 2: Enhance User Facts for Dates

1. Add migration for `fact_type` column or date-specific category
2. Update `memoryService.ts` with `getUpcomingImportantDates()`
3. Update LLM tool to store date facts with proper format

### Phase 3: Build Greeting Context Functions

1. Implement each builder function
2. Add `getLastInteractionTime()` to query conversation history
3. Add `getPastCalendarEvents(since: Date)` to calendar service

### Phase 4: Slim Down buildSystemPromptForGreeting

1. Remove all sections listed in "REMOVE" table
2. Keep all sections listed in "KEEP" table
3. Add new greeting-specific sections in logical order

### Phase 5: Testing

1. Add unit tests for each new builder function
2. Add snapshot test for greeting prompt
3. Manual testing with different scenarios:
   - Early morning greeting
   - Greeting after 1 week absence
   - Greeting on user's birthday
   - Greeting day after Christmas

---

## Proposed Greeting Prompt Structure

```
1. Identity Anchor + Anti-Assistant
2. KAYLEY_CONDENSED_PROFILE
3. Tools Section (for task_action)
4. Relationship Tier Prompt
5. --- GREETING CONTEXT ---
   - Time of Day Context
   - Last Interaction Context
   - Important Dates (if any)
   - Holiday Context (if applicable)
   - Past Events to Follow Up (since last interaction)
   - Bidirectional Check-in Guidance
6. Calendar (Today + Upcoming)
7. Daily Checklist (with task age for high-priority)
8. News Context
9. Open Loops / Promises to Address
10. Output Format Section
11. Critical Output Rules (MUST be last)
```

Estimated prompt size: ~40-50% of current NonGreeting prompt

---

## Questions Resolved

| Question | Answer |
|----------|--------|
| User Dates storage | Add category to user_facts (e.g., `category: 'birthday'`) |
| Time thresholds | Early <8am, Normal 8am-8pm, Late >8pm |
| Check-in direction | Bidirectional - Kayley shares AND asks |
| Past Calendar use | Context for follow-up (e.g., "How was Christmas?") |
| Personal News | Open loops/follow-ups/promises |
| Task age tracking | Already exists via `created_at` and `scheduled_date` |
| Last interaction | Query `conversation_history.created_at` |

---

## Files to Create/Modify

### New Files
- `src/services/system_prompts/greeting/timeOfDay.ts`
- `src/services/system_prompts/greeting/importantDates.ts`
- `src/services/system_prompts/greeting/holidayContext.ts`
- `src/services/system_prompts/greeting/pastEventsContext.ts`
- `src/services/system_prompts/greeting/lastInteraction.ts`
- `src/services/system_prompts/greeting/checkInGuidance.ts`
- `src/services/system_prompts/greeting/index.ts`

### Modified Files
- `src/services/system_prompts/builders/systemPromptBuilder.ts` - Slim greeting function
- `src/services/memoryService.ts` - Add `getUpcomingImportantDates()`
- `src/services/calendarService.ts` - Add `getPastCalendarEvents()`
- `src/services/stateService.ts` - Add `getLastInteractionTime()`

### Migration (Optional)
- `supabase/migrations/xxx_add_fact_type_to_user_facts.sql` - If needed for date storage

---

## Success Criteria

1. Greeting prompt is 40-50% smaller than NonGreeting
2. Greeting feels personalized (time of day, important dates, follow-ups)
3. All existing tests pass
4. New snapshot tests for greeting prompt
5. Manual test: Greeting after absence correctly follows up on past events
