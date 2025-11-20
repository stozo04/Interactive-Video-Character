# ChatGPT Memory Integration - Detailed Implementation Guide

This document provides a comprehensive, step-by-step guide for implementing ChatGPT Memory Integration into the Interactive Video Character application.

## Table of Contents

1. [Overview](#overview)
2. [Architecture & Data Flow](#architecture--data-flow)
3. [Database Schema Changes](#database-schema-changes)
4. [API Integration Setup](#api-integration-setup)
5. [Implementation Steps](#implementation-steps)
6. [Workflow Diagrams](#workflow-diagrams)
7. [Code Structure](#code-structure)
8. [Error Handling & Edge Cases](#error-handling--edge-cases)
9. [Testing Strategy](#testing-strategy)

---

## Overview

### Goal
Transform characters from static action players into evolving AI companions that remember user information, conversation history, and relationship context across sessions.

### Key Components
1. **Memory Service** - Handles all ChatGPT memory API interactions
2. **Memory Database** - Stores memory metadata and relationships in Supabase
3. **Conversation Processor** - Extracts and stores information from conversations
4. **Response Generator** - Uses memories to create personalized responses
5. **Memory Manager** - Handles memory lifecycle (creation, retrieval, pruning)

---

## Architecture & Data Flow

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface                          │
│  (ChatPanel, VideoPlayer, Character Selection)                  │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         App.tsx                                 │
│  - Manages character state                                      │
│  - Handles user messages                                        │
│  - Coordinates memory & action flow                            │
└──────────────┬──────────────────────────────┬───────────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────┐    ┌──────────────────────────────┐
│   Memory Service         │    │   Action Matching           │
│   (memoryService.ts)     │    │   (Existing System)         │
│                          │    │                              │
│  - Create memories       │    │  - Match user commands       │
│  - Retrieve memories     │    │  - Play action videos        │
│  - Update memories       │    │                              │
│  - Delete memories       │    │                              │
└──────────┬───────────────┘    └──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ChatGPT Memory API                           │
│  - Memory creation/retrieval                                     │
│  - Context injection                                             │
│  - Memory updates                                                │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase Database                            │
│  - characters table (existing)                                   │
│  - character_memories table (new)                                │
│  - character_relationships table (new)                          │
│  - conversation_history table (new)                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema Changes

### 1. Character Memories Table

```sql
CREATE TABLE public.character_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id TEXT NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, -- Could be session ID, browser fingerprint, or actual user ID
  memory_id TEXT NOT NULL, -- ChatGPT memory ID
  memory_type TEXT NOT NULL CHECK (memory_type IN (
    'user_info',      -- User's name, preferences, etc.
    'preference',     -- User's likes/dislikes
    'conversation',   -- Conversation context
    'relationship',   -- Relationship milestones
    'action_pattern'  -- Action usage patterns
  )),
  content_summary TEXT, -- Human-readable summary of what's remembered
  importance_score INTEGER DEFAULT 50 CHECK (importance_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  
  UNIQUE(character_id, user_id, memory_id)
);

CREATE INDEX idx_character_memories_character_user 
  ON public.character_memories(character_id, user_id, is_active);
CREATE INDEX idx_character_memories_type 
  ON public.character_memories(memory_type, importance_score DESC);
```

### 2. Character Relationships Table

```sql
CREATE TABLE public.character_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id TEXT NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  first_interaction_at TIMESTAMPTZ DEFAULT NOW(),
  last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
  interaction_count INTEGER DEFAULT 1,
  relationship_stage TEXT DEFAULT 'acquaintance' CHECK (relationship_stage IN (
    'new',
    'acquaintance',
    'friend',
    'close_friend',
    'companion'
  )),
  total_conversation_time INTEGER DEFAULT 0, -- in seconds
  favorite_actions TEXT[], -- Array of action IDs
  inside_jokes TEXT[], -- Array of memorable conversation snippets
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(character_id, user_id)
);

CREATE INDEX idx_character_relationships_user 
  ON public.character_relationships(character_id, user_id);
```

### 3. Conversation History Table (Enhanced)

```sql
CREATE TABLE public.conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id TEXT NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL, -- Unique session identifier
  message_role TEXT NOT NULL CHECK (message_role IN ('user', 'character', 'system')),
  message_text TEXT NOT NULL,
  action_id TEXT REFERENCES public.character_actions(id), -- If action was triggered
  memories_used TEXT[], -- Array of memory IDs referenced
  memories_created TEXT[], -- Array of memory IDs created from this message
  sentiment_score REAL, -- -1 to 1, for emotional tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  FOREIGN KEY (character_id, user_id) 
    REFERENCES public.character_relationships(character_id, user_id)
);

CREATE INDEX idx_conversation_history_character_user 
  ON public.conversation_history(character_id, user_id, created_at DESC);
CREATE INDEX idx_conversation_history_session 
  ON public.conversation_history(session_id, created_at);
```

---

## API Integration Setup

### 1. Environment Variables

Add to `.env.local`:
```env
OPENAI_API_KEY=your_openai_api_key
CHATGPT_MODEL=gpt-4o-mini  # or gpt-4o, gpt-4-turbo
MEMORY_ENABLED=true
```

### 2. Install Dependencies

```bash
npm install openai
npm install --save-dev @types/node
```

### 3. ChatGPT Memory API Overview

The ChatGPT Memory API allows you to:
- **Create memories** - Store information about users
- **Retrieve memories** - Get relevant memories for context
- **Update memories** - Modify existing memories
- **Delete memories** - Remove outdated information

**Key Concepts:**
- Memories are associated with a **thread** (conversation)
- Each memory has a **type** and **content**
- Memories can be **queried** by relevance
- Memories have **importance scores** for prioritization

---

## Implementation Steps

### Phase 1: Core Infrastructure (Week 1)

#### Step 1.1: Create Memory Service Foundation

**File: `services/memoryService.ts`**

```typescript
// Basic structure to start with
import OpenAI from 'openai';
import { supabase } from './supabaseClient';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface Memory {
  id: string;
  type: 'user_info' | 'preference' | 'conversation' | 'relationship' | 'action_pattern';
  content: string;
  importance: number;
  createdAt: Date;
}

export class MemoryService {
  // Implementation details in next steps
}
```

#### Step 1.2: User Identification System

**Decision Point:** How to identify users?
- **Option A:** Browser fingerprinting (localStorage + device info)
- **Option B:** Session-based (temporary, per-browser-session)
- **Option C:** User accounts (requires authentication)

**Recommended:** Start with Option A (browser fingerprinting) for MVP, upgrade to Option C later.

**File: `services/userIdService.ts`**

```typescript
export const getUserId = (): string => {
  // Generate or retrieve stable user ID
  // Store in localStorage
  // Combine with device fingerprint for uniqueness
};
```

#### Step 1.3: Database Migration Scripts

Create migration files for Supabase:
- `supabase/migrations/001_create_memory_tables.sql`
- `supabase/migrations/002_create_relationship_tables.sql`
- `supabase/migrations/003_create_conversation_history.sql`

---

### Phase 2: Memory Creation & Storage (Week 2)

#### Step 2.1: Implement Memory Detection

**What to Extract:**
- User's name ("My name is...", "I'm...", "Call me...")
- Preferences ("I like...", "I love...", "I hate...")
- Personal information ("I work at...", "I live in...")
- Emotional state ("I'm feeling...", "I'm stressed...")
- Action preferences ("I always want...", "I prefer...")

**File: `services/memoryExtractor.ts`**

```typescript
export interface ExtractedMemory {
  type: Memory['type'];
  content: string;
  confidence: number; // 0-1, how confident we are this is worth remembering
  importance: number; // 0-100
}

export const extractMemories = async (
  message: string,
  conversationContext: ChatMessage[]
): Promise<ExtractedMemory[]> => {
  // Use ChatGPT to analyze message and extract memories
  // Return array of potential memories
};
```

#### Step 2.2: Create Memory in ChatGPT

**File: `services/memoryService.ts` - Create Method**

```typescript
export const createMemory = async (
  characterId: string,
  userId: string,
  memory: ExtractedMemory
): Promise<string> => {
  // 1. Create memory in ChatGPT API
  // 2. Store metadata in Supabase
  // 3. Return memory ID
};
```

**ChatGPT API Call:**
```typescript
const threadId = await getOrCreateThread(characterId, userId);
const memoryResponse = await openai.beta.threads.messages.create(threadId, {
  role: 'user',
  content: `Remember: ${memory.content}`,
  metadata: {
    memory_type: memory.type,
    importance: memory.importance.toString()
  }
});
```

#### Step 2.3: Store Memory Metadata

```typescript
await supabase.from('character_memories').insert({
  character_id: characterId,
  user_id: userId,
  memory_id: memoryResponse.id,
  memory_type: memory.type,
  content_summary: memory.content,
  importance_score: memory.importance,
  is_active: true
});
```

---

### Phase 3: Memory Retrieval (Week 2-3)

#### Step 3.1: Retrieve Relevant Memories

**File: `services/memoryService.ts` - Retrieve Method**

```typescript
export const retrieveRelevantMemories = async (
  characterId: string,
  userId: string,
  context: string, // Current conversation context
  limit: number = 10
): Promise<Memory[]> => {
  // 1. Query Supabase for active memories
  // 2. Use ChatGPT to rank by relevance
  // 3. Return top N memories
  // 4. Update last_accessed_at
};
```

**Query Strategy:**
1. Get all active memories for character-user pair
2. Use ChatGPT to score relevance to current context
3. Sort by (relevance_score * importance_score)
4. Return top N

#### Step 3.2: Build Memory Context String

```typescript
export const buildMemoryContext = (memories: Memory[]): string => {
  return memories
    .map(m => `- ${m.content_summary}`)
    .join('\n');
};
```

**Example Output:**
```
User Information:
- User's name is Alex
- User works in tech
- User loves hiking

Preferences:
- Prefers action videos when stressed
- Likes relaxing actions in the evening

Recent Context:
- Mentioned planning a trip to Paris
- Was feeling tired yesterday
```

---

### Phase 4: Response Generation (Week 3)

#### Step 4.1: Integrate Memory into Chat Flow

**File: `App.tsx` - Modified handleSendMessage**

```typescript
const handleSendMessage = async (message: string) => {
  if (!selectedCharacter) return;
  
  registerInteraction();
  setErrorMessage(null);
  setChatHistory((prev) => [...prev, { role: 'user', text: message }]);
  setIsProcessingAction(true);

  try {
    // 1. Retrieve relevant memories
    const memories = await memoryService.retrieveRelevantMemories(
      selectedCharacter.id,
      userId,
      message,
      10
    );
    
    // 2. Extract new memories from message
    const extractedMemories = await memoryExtractor.extractMemories(
      message,
      chatHistory
    );
    
    // 3. Create new memories if needed
    for (const memory of extractedMemories) {
      if (memory.confidence > 0.7) {
        await memoryService.createMemory(
          selectedCharacter.id,
          userId,
          memory
        );
      }
    }
    
    // 4. Check for action match (existing logic)
    const matchingAction = findMatchingAction(
      message,
      selectedCharacter.actions
    );
    
    // 5. Generate personalized response using ChatGPT
    const response = await generatePersonalizedResponse(
      message,
      memories,
      matchingAction,
      selectedCharacter
    );
    
    // 6. Update relationship stats
    await updateRelationshipStats(selectedCharacter.id, userId);
    
    // 7. Store conversation history
    await storeConversationHistory(
      selectedCharacter.id,
      userId,
      message,
      response,
      matchingAction?.id
    );
    
    // 8. Play action if matched
    if (matchingAction) {
      // ... existing action playback logic
    }
    
    // 9. Add response to chat
    setChatHistory((prev) => [
      ...prev,
      { role: 'model', text: response }
    ]);
    
  } finally {
    setIsProcessingAction(false);
  }
};
```

#### Step 4.2: Generate Personalized Response

**File: `services/responseGenerator.ts`**

```typescript
export const generatePersonalizedResponse = async (
  userMessage: string,
  memories: Memory[],
  matchingAction: CharacterAction | null,
  character: CharacterProfile
): Promise<string> => {
  const memoryContext = buildMemoryContext(memories);
  
  const systemPrompt = `You are ${character.name || 'a character'} in an interactive video app.
  
User Information:
${memoryContext}

Your personality: [Character personality description]
Available actions: ${formatActionList(character.actions)}

Guidelines:
- Be conversational and friendly
- Reference past conversations naturally when relevant
- If an action matches, acknowledge it briefly
- Keep responses under 20 words unless the user asks a question
- Use the user's name if you know it`;

  const response = await openai.chat.completions.create({
    model: process.env.CHATGPT_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      ...recentChatHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.text
      })),
      { role: 'user', content: userMessage }
    ],
  });
  
  return response.choices[0].message.content || '';
};
```

---

### Phase 5: Relationship Tracking (Week 4)

#### Step 5.1: Initialize Relationship

**File: `services/relationshipService.ts`**

```typescript
export const getOrCreateRelationship = async (
  characterId: string,
  userId: string
): Promise<Relationship> => {
  // Check if relationship exists
  // If not, create new one
  // Update last_interaction_at and interaction_count
};
```

#### Step 5.2: Track Relationship Milestones

```typescript
export const checkRelationshipMilestones = async (
  characterId: string,
  userId: string
): Promise<string | null> => {
  const relationship = await getOrCreateRelationship(characterId, userId);
  
  // Check for milestones:
  // - First interaction
  // - 10 interactions
  // - 50 interactions
  // - 100 interactions
  // - 1 week of interactions
  // - 1 month of interactions
  
  // Return milestone message if reached
};
```

#### Step 5.3: Update Relationship Stage

```typescript
const calculateRelationshipStage = (
  interactionCount: number,
  totalTime: number,
  daysSinceFirst: number
): RelationshipStage => {
  if (interactionCount < 5) return 'new';
  if (interactionCount < 20) return 'acquaintance';
  if (interactionCount < 50) return 'friend';
  if (interactionCount < 100) return 'close_friend';
  return 'companion';
};
```

---

### Phase 6: Memory Management (Week 4-5)

#### Step 6.1: Memory Pruning

**File: `services/memoryPruner.ts`**

```typescript
export const pruneMemories = async (
  characterId: string,
  userId: string
): Promise<void> => {
  // 1. Get all memories
  // 2. Calculate scores: (importance * recency * access_frequency)
  // 3. Mark low-scoring memories as inactive
  // 4. Delete very old inactive memories
  // 5. Limit total active memories (e.g., top 50)
};
```

**Pruning Criteria:**
- Memories not accessed in 30+ days with low importance → inactive
- Inactive memories older than 90 days → delete
- Keep maximum 50 active memories per character-user pair
- Always keep relationship milestones active

#### Step 6.2: Memory Consolidation

```typescript
export const consolidateMemories = async (
  characterId: string,
  userId: string
): Promise<void> => {
  // Use ChatGPT to identify similar/duplicate memories
  // Merge duplicates
  // Update importance scores based on frequency
};
```

---

## Workflow Diagrams

### Workflow 1: Character Load & Memory Initialization

```
┌─────────────────┐
│ User Selects    │
│ Character       │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ handleSelectCharacter()        │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Load Character from Supabase    │
│ - Character profile             │
│ - Actions                       │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Initialize Memory System        │
│ 1. Get or create userId         │
│ 2. Get or create relationship   │
│ 3. Retrieve recent memories     │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Generate Personalized Greeting  │
│ - Use memories for context      │
│ - Reference past if applicable  │
│ - Include relationship stage    │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Display Character               │
│ - Show greeting                 │
│ - Play greeting action (if any) │
└─────────────────────────────────┘
```

### Workflow 2: User Message Processing

```
┌─────────────────┐
│ User Sends      │
│ Message         │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ handleSendMessage()             │
│ 1. Add to chat history          │
│ 2. Set processing state         │
└────────┬────────────────────────┘
         │
         ├─────────────────────────────────┐
         │                                   │
         ▼                                   ▼
┌─────────────────────────┐    ┌──────────────────────────────┐
│ Retrieve Memories       │    │ Extract New Memories         │
│ - Query Supabase        │    │ - Analyze message            │
│ - Get relevant memories │    │ - Identify extractable info  │
│ - Build context string  │    │ - Calculate confidence      │
└────────┬────────────────┘    └────────┬─────────────────────┘
         │                              │
         └──────────────┬───────────────┘
                        │
                        ▼
┌─────────────────────────────────┐
│ Create New Memories             │
│ (if confidence > threshold)     │
│ - Call ChatGPT Memory API       │
│ - Store in Supabase             │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Check Action Match              │
│ - Use existing findMatchingAction│
│ - Return matching action or null│
└────────┬────────────────────────┘
         │
         ├─────────────────────────────────┐
         │                                   │
         ▼                                   ▼
┌─────────────────────────┐    ┌──────────────────────────────┐
│ Generate Response       │    │ Play Action Video            │
│ - Use ChatGPT with      │    │ - Set current video URL       │
│   memory context        │    │ - Update action ID           │
│ - Include action info   │    │ - Register interaction       │
│ - Personalize response  │    └──────────────────────────────┘
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Update Relationship Stats       │
│ - Increment interaction count   │
│ - Update last interaction time  │
│ - Check for milestones          │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Store Conversation History      │
│ - Save message & response       │
│ - Link to memories used        │
│ - Track action if played        │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Update UI                       │
│ - Add response to chat          │
│ - Clear processing state        │
│ - Show action if played         │
└─────────────────────────────────┘
```

### Workflow 3: Memory Lifecycle

```
┌─────────────────┐
│ Memory Created  │
│ (from message)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Store in ChatGPT                │
│ - Create via API                 │
│ - Get memory ID                  │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Store Metadata in Supabase      │
│ - character_id                  │
│ - user_id                       │
│ - memory_id (from ChatGPT)      │
│ - type, content, importance     │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Memory Active                    │
│ - Available for retrieval        │
│ - Tracked in database            │
└────────┬────────────────────────┘
         │
         │ (Periodically)
         ▼
┌─────────────────────────────────┐
│ Memory Pruning Process          │
│ 1. Calculate scores             │
│ 2. Mark low-score as inactive   │
│ 3. Delete very old inactive     │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Memory Retrieved                │
│ - Update last_accessed_at       │
│ - Increase access frequency     │
│ - Used in response generation   │
└─────────────────────────────────┘
```

### Workflow 4: Relationship Evolution

```
┌─────────────────┐
│ First Interaction│
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Create Relationship Record       │
│ - first_interaction_at = now    │
│ - relationship_stage = 'new'    │
│ - interaction_count = 1         │
└────────┬────────────────────────┘
         │
         │ (Each interaction)
         ▼
┌─────────────────────────────────┐
│ Update Relationship              │
│ - Increment interaction_count   │
│ - Update last_interaction_at    │
│ - Add to total_conversation_time│
└────────┬────────────────────────┘
         │
         │ (Periodically)
         ▼
┌─────────────────────────────────┐
│ Check Milestones                │
│ - 10 interactions → acquaintance│
│ - 50 interactions → friend      │
│ - 100 interactions → close_friend│
│ - 1 month → companion           │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Update Relationship Stage       │
│ - Calculate new stage           │
│ - Store milestone memory        │
│ - Generate milestone message    │
└─────────────────────────────────┘
```

---

## Code Structure

### File Organization

```
services/
├── memoryService.ts          # Main memory service (create, retrieve, update, delete)
├── memoryExtractor.ts        # Extract memories from messages
├── responseGenerator.ts     # Generate personalized responses
├── relationshipService.ts   # Manage character-user relationships
├── memoryPruner.ts          # Memory lifecycle management
├── userIdService.ts         # User identification
└── conversationHistory.ts   # Store conversation logs

types/
├── memory.ts                # Memory-related types
└── relationship.ts          # Relationship types

components/
└── (existing components)
```

### Key Type Definitions

**File: `types/memory.ts`**

```typescript
export type MemoryType = 
  | 'user_info'
  | 'preference'
  | 'conversation'
  | 'relationship'
  | 'action_pattern';

export interface Memory {
  id: string;
  characterId: string;
  userId: string;
  memoryId: string; // ChatGPT memory ID
  type: MemoryType;
  contentSummary: string;
  importance: number; // 0-100
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  isActive: boolean;
}

export interface ExtractedMemory {
  type: MemoryType;
  content: string;
  confidence: number; // 0-1
  importance: number; // 0-100
}

export interface MemoryContext {
  userInfo: Memory[];
  preferences: Memory[];
  recentContext: Memory[];
  relationshipMilestones: Memory[];
}
```

**File: `types/relationship.ts`**

```typescript
export type RelationshipStage = 
  | 'new'
  | 'acquaintance'
  | 'friend'
  | 'close_friend'
  | 'companion';

export interface Relationship {
  id: string;
  characterId: string;
  userId: string;
  firstInteractionAt: Date;
  lastInteractionAt: Date;
  interactionCount: number;
  relationshipStage: RelationshipStage;
  totalConversationTime: number; // seconds
  favoriteActions: string[];
  insideJokes: string[];
}
```

---

## Error Handling & Edge Cases

### Error Scenarios

1. **ChatGPT API Failure**
   - Fallback to action-only mode (no memory)
   - Log error, continue without personalization
   - Retry with exponential backoff

2. **Memory Creation Failure**
   - Log error but don't block user interaction
   - Queue for retry later
   - Continue with existing memories

3. **Memory Retrieval Failure**
   - Use cached memories if available
   - Fallback to empty context
   - Don't block response generation

4. **Database Connection Issues**
   - Use in-memory cache for recent memories
   - Queue writes for when connection restored
   - Show user-friendly error message

5. **User ID Generation Failure**
   - Use session-based temporary ID
   - Warn user that memories won't persist
   - Offer to create account

### Edge Cases

1. **First-Time User**
   - No memories exist
   - Use default greeting
   - Start building relationship

2. **User Returns After Long Absence**
   - Memories may be stale
   - Refresh relationship stage
   - Acknowledge time passed

3. **Multiple Characters, Same User**
   - Separate memory stores per character
   - Characters don't share memories
   - Each has independent relationship

4. **Memory Limit Reached**
   - Prune low-importance memories
   - Consolidate similar memories
   - Keep relationship milestones

5. **Conflicting Information**
   - Newer information overrides older
   - Update existing memory rather than duplicate
   - Log conflicts for review

---

## Testing Strategy

### Unit Tests

1. **Memory Extraction**
   - Test name extraction ("My name is...")
   - Test preference extraction ("I like...")
   - Test confidence scoring
   - Test edge cases (ambiguous statements)

2. **Memory Retrieval**
   - Test relevance scoring
   - Test importance weighting
   - Test limit enforcement
   - Test access time updates

3. **Response Generation**
   - Test memory context injection
   - Test personalization
   - Test action integration
   - Test length limits

### Integration Tests

1. **End-to-End Conversation Flow**
   - User introduces themselves
   - Character remembers name
   - User returns later
   - Character uses name

2. **Relationship Progression**
   - Track interactions
   - Verify stage changes
   - Test milestone detection

3. **Memory Lifecycle**
   - Create memory
   - Retrieve memory
   - Update memory
   - Prune memory

### Manual Testing Checklist

- [ ] User can introduce themselves
- [ ] Character remembers name in next session
- [ ] Character references past conversations
- [ ] Relationship stage progresses correctly
- [ ] Memories are created for important info
- [ ] Low-importance info is pruned
- [ ] Multiple characters have separate memories
- [ ] Error handling works gracefully
- [ ] Performance is acceptable (<2s response time)

---

## Implementation Timeline

### Week 1: Foundation
- [ ] Database schema setup
- [ ] User ID service
- [ ] Basic memory service structure
- [ ] Environment configuration

### Week 2: Core Features
- [ ] Memory extraction
- [ ] Memory creation
- [ ] Memory retrieval
- [ ] Basic response generation

### Week 3: Integration
- [ ] Integrate into chat flow
- [ ] Relationship tracking
- [ ] Conversation history storage
- [ ] UI updates for personalized responses

### Week 4: Enhancement
- [ ] Memory pruning
- [ ] Relationship milestones
- [ ] Error handling
- [ ] Performance optimization

### Week 5: Polish
- [ ] Testing
- [ ] Bug fixes
- [ ] Documentation
- [ ] User feedback iteration

---

## Next Steps

1. **Review this document** - Ensure all requirements are clear
2. **Set up database** - Run migration scripts in Supabase
3. **Create service files** - Set up basic structure
4. **Implement Phase 1** - Start with foundation
5. **Test incrementally** - Test each phase before moving on
6. **Iterate based on feedback** - Adjust as needed

---

## Additional Resources

- [OpenAI API Documentation](https://platform.openai.com/docs)
- [ChatGPT Memory API Guide](https://platform.openai.com/docs/guides/memory)
- [Supabase Documentation](https://supabase.com/docs)
- [React Best Practices](https://react.dev/learn)

---

## Questions to Consider

1. **User Identification:** How will you handle user identification? (Browser fingerprint vs accounts)
2. **Memory Limits:** What's the maximum number of memories per character-user pair?
3. **Privacy:** How will you handle user data privacy and GDPR compliance?
4. **Costs:** ChatGPT API calls have costs - what's your budget?
5. **Performance:** How will you ensure fast response times with memory retrieval?

---

This implementation guide provides a comprehensive roadmap for adding ChatGPT Memory Integration to your Interactive Video Character application. Start with Phase 1 and work through each phase systematically, testing as you go.

