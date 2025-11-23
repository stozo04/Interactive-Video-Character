Here is a comprehensive, step-by-step Junior Developer guide to implementing the "Recall" (RAG Search) feature. This guide focuses on simplicity and leveraging your existing architecture.

🧠 Feature: "Recall" (Memory Search) Implementation Guide
🎯 The Objective
Problem: The user tells Kayley things (e.g., "My mom loves roses"), but she forgets them in the next session because they aren't part of her immediate context window. Solution: We will create a specific "Memory Box" (Database Table). When the user asks "What did I say about...?", we will search this box, find the note, and show it to Kayley before she answers.

🛠️ Phase 1: The Database (The "Memory Box")
We need a place to store facts. We will create a simple table in Supabase.

1. Run this SQL in Supabase
Go to your Supabase Dashboard -> SQL Editor and run this script. It enables a basic keyword search.

SQL

-- 1. Create the memories table
create table public.character_memories (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  content text not null, -- The fact (e.g. "User's mom loves Italian food")
  tags text[],           -- Keywords (e.g. ["mom", "food"])
  created_at timestamptz default now()
);

-- 2. Enable Row Level Security (Optional but good practice)
alter table public.character_memories enable row level security;

-- 3. Create a simple search function
-- This allows us to fuzzy search the 'content' column
create or replace function search_memories(
  query_text text, 
  match_user_id text, 
  match_threshold float default 0.1
)
returns setof character_memories
language plpgsql
as $$
begin
  return query
  select *
  from character_memories
  where user_id = match_user_id
  and content ilike '%' || query_text || '%';
end;
$$;
📡 Phase 2: The Service (The "Librarian")
Create File: src/services/memoryService.ts

This service handles saving new memories and finding old ones.

TypeScript

import { supabase } from './supabaseClient';

export interface Memory {
  id: string;
  content: string;
  created_at: string;
}

export const memoryService = {
  /**
   * Save a new fact
   */
  async saveMemory(userId: string, content: string) {
    const { error } = await supabase
      .from('character_memories')
      .insert({ user_id: userId, content });
    
    if (error) console.error("Failed to save memory:", error);
  },

  /**
   * Find memories matching a keyword
   */
  async searchMemories(userId: string, query: string): Promise<Memory[]> {
    // Simple keyword search for MVP
    const { data, error } = await supabase
      .from('character_memories')
      .select('*')
      .eq('user_id', userId)
      .ilike('content', `%${query}%`) // Searching for the query text anywhere
      .limit(5);

    if (error) {
      console.error("Memory search failed:", error);
      return [];
    }
    return data || [];
  }
};
🧠 Phase 3: Update the "Brain" Interfaces
File: src/services/aiService.ts

We need to teach our AI service that it might receive "Relevant Memories" along with chat history.

Action: Update the AIChatOptions interface.

TypeScript

export interface AIChatOptions {
  character?: CharacterProfile;
  chatHistory?: ChatMessage[];
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[];
  // 👇 ADD THIS LINE
  relevantMemories?: string[]; 
}
📝 Phase 4: Update the System Prompt
File: src/services/promptUtils.ts

Now we tell the AI: "If I give you memories, use them to answer the question."

Action: Update buildSystemPrompt to accept and render memories.

TypeScript

// 1. Update arguments
export const buildSystemPrompt = (
  character?: CharacterProfile,
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = [],
  relevantMemories: string[] = [] // 👈 Add this default empty array
): string => {
  
  // ... existing code ...

  // 2. Add this section near the end of the prompt string
  if (relevantMemories.length > 0) {
    prompt += `
    
[RECOVERED MEMORIES]
The user is asking about the past. Here is what we found in the database:
${relevantMemories.map(m => `- ${m}`).join('\n')}

Use these facts to answer the user's question accurately.
`;
  }

  return prompt;
};
🚀 Phase 5: Connect the Logic (The "Trigger")
File: src/App.tsx

This is where the magic happens. We will check if the user is asking a "Recall" question inside handleSendMessage.

1. Detect Intent & Search Inside handleSendMessage, before generating the response:

TypeScript

// src/App.tsx

const handleSendMessage = async (message: string) => {
  // ... existing setup ...

  const userId = getUserId();
  let foundMemories: string[] = [];

  // 1. Simple "Recall" Detection (Regex)
  // Looks for: "what did i say about X" or "do you remember X"
  const recallPattern = /(what did i (say|tell)|do you remember|remind me about) (.+)/i;
  const match = message.match(recallPattern);

  if (match) {
    const searchQuery = match[3]; // The "X" part (e.g., "my mom")
    console.log(`🧠 Searching memory for: "${searchQuery}"`);
    
    const results = await memoryService.searchMemories(userId, searchQuery);
    foundMemories = results.map(r => r.content);
    
    if (foundMemories.length > 0) {
      console.log("🧠 Found memories:", foundMemories);
    }
  }

  // ... existing sentiment analysis ...

  // 2. Pass memories to the AI
  const { response, session: updatedSession, audioData } = await activeService.generateResponse(
    { type: 'text', text: message },
    {
      character: selectedCharacter,
      chatHistory,
      relationship: updatedRelationship,
      upcomingEvents,
      relevantMemories: foundMemories // 👈 Pass the found facts here!
    },
    sessionToUse
  );

  // ... rest of function ...
};
Don't forget: You also need to pass relevantMemories from activeService.generateResponse into buildSystemPrompt inside your grokChatService.ts (and geminiChatService.ts if you use it).

Update src/services/grokChatService.ts:

TypeScript

// Inside generateResponse...
const { 
  character, 
  chatHistory, 
  relationship, 
  upcomingEvents, 
  relevantMemories // 👈 Destructure this
} = options;

// Pass it to buildSystemPrompt
const systemPrompt = buildSystemPrompt(
  character, 
  relationship, 
  upcomingEvents, 
  relevantMemories // 👈 Pass it here
);
🧪 Verification Checklist
Seed Data: Manually insert a row into character_memories via Supabase dashboard.

user_id: (Your ID from .env)

content: "My favorite color is bright orange."

The Test:

Open App.

Type: "What did I say is my favorite color?"

Success Criteria:

Console logs: 🧠 Searching memory for: "is my favorite color" (or similar).

Console logs: 🧠 Found memories: ["My favorite color is bright orange."]

Kayley says: "You told me your favorite color is bright orange!"

Congratulations! Your character now has long-term memory recall. 🧠