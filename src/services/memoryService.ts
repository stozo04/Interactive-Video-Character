// src/services/memoryService.ts
/**
 * Memory Service
 * 
 * Provides AI with the ability to search and recall past conversations
 * and user facts on-demand, enabling fresh chat sessions while maintaining
 * context awareness through tool-based memory retrieval.
 */

import { supabase } from './supabaseClient';

// ============================================
// Types
// ============================================

export interface MemorySearchResult {
  id: string;
  text: string;
  role: 'user' | 'model';
  timestamp: string;
  relevanceScore?: number;
}

export interface UserFact {
  id: string;
  user_id: string;
  category: 'identity' | 'preference' | 'relationship' | 'context';
  fact_key: string;
  fact_value: string;
  source_message_id?: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export type FactCategory = 'identity' | 'preference' | 'relationship' | 'context' | 'all';

// ============================================
// Constants
// ============================================

const CONVERSATION_HISTORY_TABLE = 'conversation_history';
const USER_FACTS_TABLE = 'user_facts';

// Default limits to prevent context overflow
const DEFAULT_MEMORY_LIMIT = 5;
const DEFAULT_RECENT_CONTEXT_COUNT = 6; // Last 3 exchanges (user + model)

// ============================================
// Memory Search Functions
// ============================================

/**
 * Search past conversations for messages matching a query.
 * Uses simple text matching (ILIKE) for now - can be upgraded to 
 * full-text search or vector embeddings later.
 * 
 * @param userId - The user's ID
 * @param query - Natural language search query
 * @param limit - Maximum number of results (default: 5)
 * @param timeframe - 'recent' (last 7 days) or 'all' (entire history)
 * @returns Array of matching messages with relevance context
 */
export const searchMemories = async (
  userId: string,
  query: string,
  limit: number = DEFAULT_MEMORY_LIMIT,
  timeframe: 'recent' | 'all' = 'all'
): Promise<MemorySearchResult[]> => {
  try {
    console.log(`🔍 [Memory] Searching for: "${query}" (timeframe: ${timeframe})`);
    
    // Extract key terms from the query for searching
    const searchTerms = extractSearchTerms(query);
    
    if (searchTerms.length === 0) {
      console.log('🔍 [Memory] No valid search terms found');
      return [];
    }

    // Build the query
    let queryBuilder = supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select('id, message_text, message_role, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit * 3); // Fetch more than needed, we'll filter for relevance

    // Apply timeframe filter
    if (timeframe === 'recent') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      queryBuilder = queryBuilder.gte('created_at', sevenDaysAgo.toISOString());
    }

    const { data, error } = await queryBuilder;

    if (error) {
      console.error('Failed to search memories:', error);
      return [];
    }

    if (!data || data.length === 0) {
      console.log('🔍 [Memory] No messages found in history');
      return [];
    }

    // Score and filter results based on search terms
    const scoredResults = data
      .map(row => {
        const text = row.message_text.toLowerCase();
        let score = 0;
        
        // Score based on term matches
        for (const term of searchTerms) {
          if (text.includes(term.toLowerCase())) {
            score += 1;
            // Bonus for exact word match (not substring)
            if (new RegExp(`\\b${term}\\b`, 'i').test(text)) {
              score += 0.5;
            }
          }
        }
        
        return {
          id: row.id,
          text: row.message_text,
          role: row.message_role as 'user' | 'model',
          timestamp: row.created_at,
          relevanceScore: score
        };
      })
      .filter(result => result.relevanceScore! > 0)
      .sort((a, b) => b.relevanceScore! - a.relevanceScore!)
      .slice(0, limit);

    console.log(`🔍 [Memory] Found ${scoredResults.length} relevant memories`);
    return scoredResults;
    
  } catch (error) {
    console.error('Error searching memories:', error);
    return [];
  }
};

/**
 * Extract meaningful search terms from a natural language query.
 * Removes common words and phrases to get the key terms.
 */
function extractSearchTerms(query: string): string[] {
  // Common words to ignore (stopwords)
  const stopwords = new Set([
    'what', 'who', 'when', 'where', 'how', 'why', 'is', 'are', 'was', 'were',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'all', 'each', 'few', 'more', 'most', 'other',
    'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
    'too', 'very', 'can', 'will', 'just', 'should', 'now', 'their', 'they',
    'them', 'my', 'your', 'his', 'her', 'its', 'our', 'i', 'you', 'he', 'she',
    'it', 'we', 'me', 'him', 'us', 'do', 'did', 'does', 'have', 'has', 'had',
    'about', 'tell', 'said', 'like', 'know', 'remember', 'recall', 'think',
    'user', 'user\'s', "user's"
  ]);

  // Split into words, clean, and filter
  const terms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopwords.has(word));

  return [...new Set(terms)]; // Remove duplicates
}

// ============================================
// User Facts Functions
// ============================================

/**
 * Get stored facts about the user.
 * 
 * @param userId - The user's ID
 * @param category - Filter by category, or 'all' for everything
 * @returns Array of user facts
 */
export const getUserFacts = async (
  userId: string,
  category: FactCategory = 'all'
): Promise<UserFact[]> => {
  try {
    console.log(`📋 [Memory] Getting user facts (category: ${category})`);

    let queryBuilder = supabase
      .from(USER_FACTS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (category !== 'all') {
      queryBuilder = queryBuilder.eq('category', category);
    }

    const { data, error } = await queryBuilder;

    if (error) {
      console.error('Failed to get user facts:', error);
      return [];
    }

    console.log(`📋 [Memory] Found ${data?.length || 0} facts`);
    return (data as UserFact[]) || [];
    
  } catch (error) {
    console.error('Error getting user facts:', error);
    return [];
  }
};

/**
 * Store a new fact about the user or update an existing one.
 * Uses UPSERT to handle conflicts on (user_id, category, fact_key).
 * 
 * @param userId - The user's ID
 * @param category - Fact category
 * @param key - Fact key (e.g., 'name', 'job')
 * @param value - Fact value
 * @param sourceMessageId - Optional: the message ID where this was learned
 * @param confidence - Confidence score (0-1), default 1.0
 */
export const storeUserFact = async (
  userId: string,
  category: UserFact['category'],
  key: string,
  value: string,
  sourceMessageId?: string,
  confidence: number = 1.0
): Promise<boolean> => {
  try {
    console.log(`💾 [Memory] Storing fact: ${category}.${key} = "${value}"`);

    const now = new Date().toISOString();
    
    const { error } = await supabase
      .from(USER_FACTS_TABLE)
      .upsert({
        user_id: userId,
        category,
        fact_key: key,
        fact_value: value,
        source_message_id: sourceMessageId || null,
        confidence,
        updated_at: now
      }, {
        onConflict: 'user_id,category,fact_key'
      });

    if (error) {
      console.error('Failed to store user fact:', error);
      return false;
    }

    console.log(`💾 [Memory] Successfully stored fact`);
    return true;
    
  } catch (error) {
    console.error('Error storing user fact:', error);
    return false;
  }
};

/**
 * Delete a specific user fact.
 * Useful for GDPR compliance or user-requested forgetting.
 * 
 * @param userId - The user's ID
 * @param category - Fact category
 * @param key - Fact key to delete
 */
export const deleteUserFact = async (
  userId: string,
  category: UserFact['category'],
  key: string
): Promise<boolean> => {
  try {
    console.log(`🗑️ [Memory] Deleting fact: ${category}.${key}`);

    const { error } = await supabase
      .from(USER_FACTS_TABLE)
      .delete()
      .eq('user_id', userId)
      .eq('category', category)
      .eq('fact_key', key);

    if (error) {
      console.error('Failed to delete user fact:', error);
      return false;
    }

    console.log(`🗑️ [Memory] Successfully deleted fact`);
    return true;
    
  } catch (error) {
    console.error('Error deleting user fact:', error);
    return false;
  }
};

// ============================================
// Context Helper Functions
// ============================================

/**
 * Get a summary of recent conversation context.
 * Useful for providing minimal context without loading full history.
 * 
 * @param userId - The user's ID
 * @param messageCount - Number of recent messages to include
 * @returns Formatted string with recent context
 */
export const getRecentContext = async (
  userId: string,
  messageCount: number = DEFAULT_RECENT_CONTEXT_COUNT
): Promise<string> => {
  try {
    const { data, error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select('message_text, message_role, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(messageCount);

    if (error || !data || data.length === 0) {
      return 'No recent conversation context available.';
    }

    // Reverse to chronological order
    const messages = data.reverse();
    
    const contextLines = messages.map(msg => {
      const role = msg.message_role === 'user' ? 'User' : 'Kayley';
      return `${role}: ${msg.message_text}`;
    });

    return `Recent conversation:\n${contextLines.join('\n')}`;
    
  } catch (error) {
    console.error('Error getting recent context:', error);
    return 'Unable to retrieve recent context.';
  }
};

/**
 * Format memory search results into a human-readable string for the AI.
 */
export const formatMemoriesForAI = (memories: MemorySearchResult[]): string => {
  if (memories.length === 0) {
    return 'No relevant memories found.';
  }

  const lines = memories.map((m, i) => {
    const role = m.role === 'user' ? 'User said' : 'You said';
    const date = new Date(m.timestamp).toLocaleDateString();
    return `${i + 1}. [${date}] ${role}: "${m.text}"`;
  });

  return `Found ${memories.length} relevant memory/memories:\n${lines.join('\n')}`;
};

/**
 * Format user facts into a human-readable string for the AI.
 */
export const formatFactsForAI = (facts: UserFact[]): string => {
  if (facts.length === 0) {
    return 'No stored information found for this category.';
  }

  const lines = facts.map(f => {
    return `- ${f.fact_key}: ${f.fact_value}`;
  });

  return `Known facts about the user:\n${lines.join('\n')}`;
};

// ============================================
// Tool Execution Handler
// ============================================

export type MemoryToolName = 'recall_memory' | 'recall_user_info' | 'store_user_info';

export interface ToolCallArgs {
  recall_memory: {
    query: string;
    timeframe?: 'recent' | 'all';
  };
  recall_user_info: {
    category: FactCategory;
    specific_key?: string;
  };
  store_user_info: {
    category: 'identity' | 'preference' | 'relationship' | 'context';
    key: string;
    value: string;
  };
}

/**
 * Execute a memory tool call and return the result.
 * This is the main entry point for AI tool calling.
 * 
 * @param toolName - The name of the tool to execute
 * @param args - Tool-specific arguments
 * @param userId - The user's ID
 * @returns Result string to return to the AI
 */
export const executeMemoryTool = async (
  toolName: MemoryToolName,
  args: ToolCallArgs[typeof toolName],
  userId: string
): Promise<string> => {
  console.log(`🔧 [Memory Tool] Executing: ${toolName}`, args);

  try {
    switch (toolName) {
      case 'recall_memory': {
        const { query, timeframe } = args as ToolCallArgs['recall_memory'];
        const memories = await searchMemories(userId, query, DEFAULT_MEMORY_LIMIT, timeframe);
        return formatMemoriesForAI(memories);
      }

      case 'recall_user_info': {
        const { category, specific_key } = args as ToolCallArgs['recall_user_info'];
        const facts = await getUserFacts(userId, category);
        
        // If a specific key was requested, filter to just that
        if (specific_key) {
          const specificFact = facts.find(f => 
            f.fact_key.toLowerCase() === specific_key.toLowerCase()
          );
          if (specificFact) {
            return `${specificFact.fact_key}: ${specificFact.fact_value}`;
          }
          return `No information stored for "${specific_key}".`;
        }
        
        return formatFactsForAI(facts);
      }

      case 'store_user_info': {
        const { category, key, value } = args as ToolCallArgs['store_user_info'];
        const success = await storeUserFact(userId, category, key, value);
        return success 
          ? `✓ Stored: ${key} = "${value}"` 
          : `Failed to store information.`;
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error) {
    console.error(`Error executing ${toolName}:`, error);
    return `Error executing ${toolName}. Please try again.`;
  }
};

// ============================================
// CLIENT-SIDE INFO DETECTION (Backup)
// ============================================
// Since AI models don't always call tools reliably,
// this function runs after each user message to detect
// important information and store it automatically.

interface DetectedInfo {
  category: 'identity' | 'preference' | 'relationship' | 'context';
  key: string;
  value: string;
}

/**
 * Detect important user information from a message and store it.
 * This is a BACKUP to AI tool calling - it runs client-side after each message.
 * 
 * @param userId - The user's ID
 * @param message - The user's message text
 * @returns Array of info that was stored
 */
export const detectAndStoreUserInfo = async (
  userId: string,
  message: string
): Promise<DetectedInfo[]> => {
  const detected: DetectedInfo[] = [];

  // ============================================
  // NAME DETECTION
  // ============================================
  // Patterns: "I'm [name]", "My name is [name]", "I am [name]", "Call me [name]"
  const namePatterns = [
    /(?:i'm|i am|my name is|call me|this is)\s+([A-Z][a-z]+)(?:\s|!|,|\.|\?|$)/i,
    /^([A-Z][a-z]+)\s+here(?:\s|!|$)/i,  // "Steven here!"
    /(?:name'?s|names)\s+([A-Z][a-z]+)/i  // "Name's Steven"
  ];

  for (const pattern of namePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Avoid common false positives
      const falsePositives = ['hi', 'hey', 'hello', 'sure', 'yes', 'no', 'okay', 'well', 'just', 'really', 'actually'];
      if (!falsePositives.includes(name.toLowerCase()) && name.length > 1 && name.length < 20) {
        detected.push({ category: 'identity', key: 'name', value: name });
        console.log(`🔍 [Auto-Detect] Found name: ${name}`);
      }
    }
  }

  // ============================================
  // JOB/OCCUPATION DETECTION
  // ============================================
  // Patterns: "I work as", "I'm a [job]", "My job is", "I work at"
  const jobPatterns = [
    /i(?:'m| am) a[n]?\s+([\w\s]+?)(?:\s+and|\s+at|\s+for|,|\.|\!|$)/i,
    /(?:i work as|my job is|i'm working as)\s+a[n]?\s+([\w\s]+?)(?:,|\.|\!|$)/i,
    /i work (?:at|for)\s+([\w\s]+?)(?:,|\.|\!|$)/i
  ];

  for (const pattern of jobPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const job = match[1].trim();
      // Avoid false positives like "I'm a bit tired"
      const falsePositives = ['bit', 'little', 'lot', 'big', 'huge'];
      if (!falsePositives.some(fp => job.toLowerCase().startsWith(fp)) && job.length > 2 && job.length < 50) {
        detected.push({ category: 'identity', key: 'occupation', value: job });
        console.log(`🔍 [Auto-Detect] Found occupation: ${job}`);
      }
    }
  }

  // ============================================
  // PREFERENCE DETECTION (likes/loves)
  // ============================================
  // Patterns: "I love [X]", "I really like [X]", "My favorite [X] is [Y]"
  const likePatterns = [
    /i (?:really |absolutely |totally )?(?:love|like|enjoy|adore)\s+([\w\s]+?)(?:,|\.|\!|$)/i,
    /my favorite\s+([\w]+)\s+is\s+([\w\s]+?)(?:,|\.|\!|$)/i
  ];

  for (const pattern of likePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      // For "my favorite X is Y" pattern
      if (match[2]) {
        const topic = match[1].trim().toLowerCase();
        const value = match[2].trim();
        if (value.length > 1 && value.length < 50) {
          detected.push({ category: 'preference', key: `favorite_${topic}`, value: value });
          console.log(`🔍 [Auto-Detect] Found favorite ${topic}: ${value}`);
        }
      } else {
        // For "I love X" pattern
        const thing = match[1].trim();
        if (thing.length > 1 && thing.length < 30) {
          detected.push({ category: 'preference', key: 'likes', value: thing });
          console.log(`🔍 [Auto-Detect] Found like: ${thing}`);
        }
      }
    }
  }

  // ============================================
  // FAMILY/RELATIONSHIP DETECTION
  // ============================================
  // Patterns: "My wife/husband is", "My kids", "My dog's name is"
  const familyPatterns = [
    /my (wife|husband|spouse|partner)(?:'s name)?\s+is\s+([\w]+)/i,
    /my (son|daughter|child|baby)(?:'s name)?\s+is\s+([\w]+)/i,
    /my (dog|cat|pet)(?:'s name)?\s+is\s+([\w]+)/i,
    /i have (?:a |an )?(wife|husband|partner|boyfriend|girlfriend)/i,
    /i have (\d+) kids?/i,
    /i'm (married|engaged|single|divorced)/i
  ];

  for (const pattern of familyPatterns) {
    const match = message.match(pattern);
    if (match) {
      if (match[2]) {
        // Has a name (wife is Sarah, dog is Max)
        const relationship = match[1].toLowerCase();
        const name = match[2].trim();
        detected.push({ category: 'relationship', key: `${relationship}_name`, value: name });
        console.log(`🔍 [Auto-Detect] Found ${relationship} name: ${name}`);
      } else if (match[1]) {
        // Just status (I'm married, I have a wife)
        const status = match[1].toLowerCase();
        if (['married', 'engaged', 'single', 'divorced'].includes(status)) {
          detected.push({ category: 'relationship', key: 'relationship_status', value: status });
        } else if (match[1].match(/\d+/)) {
          detected.push({ category: 'relationship', key: 'number_of_kids', value: match[1] });
        } else {
          detected.push({ category: 'relationship', key: 'has_partner', value: 'yes' });
        }
        console.log(`🔍 [Auto-Detect] Found relationship info: ${status}`);
      }
    }
  }
  // ============================================
  // BIRTHDAY/DATE DETECTION
  // ============================================
  // Patterns: "My birthday is...", "I was born on...", "It is July 1st 1985" (direct answers)
  // Also handles: "July 1st", "July 1, 1985", "7/1/1985", "1st of July"
  const birthdayPatterns = [
    // Explicit statements
    /(?:my birthday is|i was born on|born on|birthday'?s?)\s+(.+?)(?:,|\.|!|\?|$)/i,
    // Direct answer patterns (when AI asked about birthday)
    /^(?:it'?s?|it is|that'?s?|that is)?\s*([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?)/i,
    // Date format: "7/1/1985" or "07-01-1985"
    /^(?:it'?s?|it is)?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    // "January 1st, 1985" format
    /^(?:it'?s?|it is)?\s*([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i,
    // "1st of July 1985" format
    /(\d{1,2}(?:st|nd|rd|th)?\s+of\s+[A-Z][a-z]+(?:\s+\d{4})?)/i
  ];

  for (const pattern of birthdayPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const birthdayValue = match[1].trim();
      // Make sure it looks like a date (has month name or numbers)
      const hasMonth = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(birthdayValue);
      const hasNumbers = /\d/.test(birthdayValue);
      
      if ((hasMonth || hasNumbers) && birthdayValue.length > 3 && birthdayValue.length < 30) {
        detected.push({ category: 'identity', key: 'birthday', value: birthdayValue });
        console.log(`🔍 [Auto-Detect] Found birthday: ${birthdayValue}`);
        break; // Only capture one birthday
      }
    }
  }

  // ============================================
  // AGE DETECTION
  // ============================================
  // Patterns: "I'm 39", "I am 39 years old", "I'm 39 yo"
  const agePatterns = [
    /(?:i'm|i am|im)\s+(\d{1,3})\s*(?:years?\s*old|yo|yrs?)?(?:\s|,|\.|\!|$)/i,
    /(?:my age is|age is)\s+(\d{1,3})/i
  ];

  for (const pattern of agePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const age = parseInt(match[1]);
      // Reasonable age range (1-120)
      if (age > 0 && age <= 120) {
        detected.push({ category: 'identity', key: 'age', value: match[1] });
        console.log(`🔍 [Auto-Detect] Found age: ${match[1]}`);
        break;
      }
    }
  }

  // ============================================
  // STORE DETECTED INFO
  // ============================================
  for (const info of detected) {
    await storeUserFact(userId, info.category, info.key, info.value);
  }

  if (detected.length > 0) {
    console.log(`✅ [Auto-Detect] Stored ${detected.length} fact(s) from user message`);
  }

  return detected;
};

// ============================================
// Export singleton-like object for convenience
// ============================================
export const memoryService = {
  searchMemories,
  getUserFacts,
  storeUserFact,
  deleteUserFact,
  getRecentContext,
  formatMemoriesForAI,
  formatFactsForAI,
  executeMemoryTool,
  detectAndStoreUserInfo
};

export default memoryService;

