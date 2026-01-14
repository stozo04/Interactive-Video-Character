// src/services/characterFactsService.ts
/**
 * Character Facts Service
 * 
 * Manages facts about the character (Kayley) that emerge in conversation
 * but aren't in the static character profile. This allows the character
 * to have consistent memories and backstory that grows over time.
 * 
 * These facts are checked against the character profile to avoid duplicates,
 * and new facts are stored persistently in Supabase.
 */

import { supabase } from './supabaseClient';
import { KAYLEY_FULL_PROFILE } from '../domain/characters/kayleyCharacterProfile';

// ============================================
// Types
// ============================================

export interface CharacterFact {
  id: string;
  character_id: string;
  category: 'quirk' | 'relationship' | 'experience' | 'preference' | 'detail' | 'other';
  fact_key: string;
  fact_value: string;
  source_message_id?: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export type CharacterFactCategory = CharacterFact['category'];

// ============================================
// Constants
// ============================================

const CHARACTER_FACTS_TABLE = 'character_facts';
const DEFAULT_CHARACTER_ID = 'kayley';

// ============================================
// Character Profile Checking
// ============================================

/**
 * Checks if a fact (or similar information) already exists in the character profile.
 * This is a simple text search - more sophisticated matching could be added later.
 * 
 * @param factKey - The fact key (e.g., 'laptop_name')
 * @param factValue - The fact value (e.g., 'Nova')
 * @returns true if the fact appears to be in the profile
 */
function isInCharacterProfile(factKey: string, factValue: string): boolean {
  const profileText = KAYLEY_FULL_PROFILE.toLowerCase();
  const keyLower = factKey.toLowerCase();
  const valueLower = factValue.toLowerCase();
  
  // Check if the value appears in the profile
  // Use word boundaries to avoid partial matches
  const valueWords = valueLower.split(/\s+/).filter(w => w.length > 2);
  
  // If it's a single word or short phrase, check for exact match
  if (valueWords.length <= 3) {
    // Check for the value as a whole phrase
    const phrasePattern = new RegExp(`\\b${valueWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}\\b`, 'i');
    if (phrasePattern.test(KAYLEY_FULL_PROFILE)) {
      return true;
    }
  }
  
  // Check for key-related patterns in profile
  // For example, if factKey is 'laptop_name', check for mentions of laptop/device names
  const keyRelatedPatterns: Record<string, RegExp[]> = {
    'laptop_name': [/laptop.*nova/i, /nova.*laptop/i, /device.*nova/i, /nova.*device/i],
    'camera_name': [/camera.*valentina/i, /valentina.*camera/i, /device.*valentina/i, /valentina.*device/i],
    'device': [/device.*nova/i, /device.*valentina/i, /names.*devices/i, /laptop.*camera/i],
    'friend': [/lena/i, /best friend/i, /friend.*lena/i],
    'brother': [/ethan/i, /brother.*ethan/i, /ethan.*brother/i],
    'family': [/mom/i, /dad/i, /mother/i, /father/i, /parents/i],
  };
  
  // Check if this key has known patterns to search for
  for (const [patternKey, patterns] of Object.entries(keyRelatedPatterns)) {
    if (keyLower.includes(patternKey) || patternKey.includes(keyLower)) {
      for (const pattern of patterns) {
        if (pattern.test(KAYLEY_FULL_PROFILE)) {
          return true;
        }
      }
    }
  }
  
  return false;
}

// ============================================
// Database Operations
// ============================================

/**
 * Get all character facts for a character
 * 
 * @param category - Optional category filter
 * @returns Array of character facts
 */
export const getCharacterFacts = async (

  category?: CharacterFactCategory
): Promise<CharacterFact[]> => {
  try {
    let query = supabase
      .from(CHARACTER_FACTS_TABLE)
      .select('*')
      .eq('character_id', DEFAULT_CHARACTER_ID)
      .order('created_at', { ascending: false });
    
    if (category) {
      query = query.eq('category', category);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Failed to get character facts:', error);
      return [];
    }
    
    return (data || []) as CharacterFact[];
  } catch (error) {
    console.error('Error getting character facts:', error);
    return [];
  }
};

/**
 * Store a new character fact or update an existing one.
 * First checks if the fact is already in the character profile.
 * 
 * @param category - Fact category
 * @param key - Fact key (e.g., 'laptop_name')
 * @param value - Fact value (e.g., 'Nova')
 * @param sourceMessageId - Optional message ID where this was learned
 * @param confidence - Confidence score (0-1), default 1.0
 * @returns true if stored, false if already in profile or storage failed
 */
export const storeCharacterFact = async (
  category: CharacterFactCategory,
  key: string,
  value: string,
  sourceMessageId?: string,
  confidence: number = 1.0
): Promise<boolean> => {
  try {
    // First check if this fact is already in the character profile
    if (isInCharacterProfile(key, value)) {
      console.log(`📋 [CharacterFacts] Fact already in profile: ${key} = "${value}"`);
      return false; // Don't store duplicates from profile
    }
    
    // Check if we already have this fact stored
    const existing = await getCharacterFacts();
    const duplicate = existing.find(
      f => f.fact_key.toLowerCase() === key.toLowerCase() &&
           f.fact_value.toLowerCase() === value.toLowerCase()
    );
    
    if (duplicate) {
      console.log(`📋 [CharacterFacts] Fact already stored: ${key} = "${value}"`);
      return false; // Already stored
    }
    
    console.log(`💾 [CharacterFacts] Storing new fact: ${category}.${key} = "${value}"`);
    
    const now = new Date().toISOString();
    
    const { error } = await supabase
      .from(CHARACTER_FACTS_TABLE)
      .upsert({
        character_id: DEFAULT_CHARACTER_ID,
        category,
        fact_key: key,
        fact_value: value,
        source_message_id: sourceMessageId || null,
        confidence,
        updated_at: now
      }, {
        onConflict: 'character_id,category,fact_key'
      });
    
    if (error) {
      console.error('Failed to store character fact:', error);
      return false;
    }
    
    console.log(`✅ [CharacterFacts] Successfully stored fact: ${key} = "${value}"`);
    return true;
    
  } catch (error) {
    console.error('Error storing character fact:', error);
    return false;
  }
};

/**
 * Format character facts for inclusion in AI prompts
 * 
 * @returns Formatted string of character facts
 */
export const formatCharacterFactsForPrompt = async (): Promise<string> => {
  const facts = await getCharacterFacts();
  
  if (facts.length === 0) {
    return '';
  }
  
  // Group by category for better organization
  const byCategory: Record<string, CharacterFact[]> = {};
  for (const fact of facts) {
    if (!byCategory[fact.category]) {
      byCategory[fact.category] = [];
    }
    byCategory[fact.category].push(fact);
  }
  
  let formatted = '\n\n## Additional Character Facts (from conversations)\n\n';
  
  const categoryLabels: Record<string, string> = {
    'quirk': 'Quirks & Habits',
    'relationship': 'Relationships',
    'experience': 'Experiences & Stories',
    'preference': 'Preferences',
    'detail': 'Specific Details',
    'other': 'Other Facts'
  };
  
  for (const [category, categoryFacts] of Object.entries(byCategory)) {
    formatted += `### ${categoryLabels[category] || category}\n\n`;
    for (const fact of categoryFacts) {
      formatted += `- **${fact.fact_key}**: ${fact.fact_value}\n`;
    }
    formatted += '\n';
  }
  
  return formatted;
};
