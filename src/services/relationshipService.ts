import { supabase } from './supabaseClient';
import { ChatMessage } from '../types';
import { GoogleGenAI } from "@google/genai"; // Import Google GenAI SDK
import {
  InsightType,
  RelationshipInsightRow,
  UpsertRelationshipInsightInput,
  relationshipInsightRowSchema,
  buildInsightKey,
  createNewInsightFromInput,
  applyObservationToInsight,
  mapInsightRowToDomain,
} from '../domain/relationships/patternInsights';
import {
  getIntimacyState as getSupabaseIntimacyState,
  saveIntimacyState as saveSupabaseIntimacyState,
  createDefaultIntimacyState,
  type IntimacyState as SupabaseIntimacyState,
} from './stateService';

const RELATIONSHIPS_TABLE = 'character_relationships';
const RELATIONSHIP_EVENTS_TABLE = 'relationship_events';
const RELATIONSHIP_INSIGHTS_TABLE = 'relationship_insights';

// Environment Variables
const GROK_API_KEY = import.meta.env.VITE_GROK_API_KEY;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const CHATGPT_API_KEY = import.meta.env.VITE_CHATGPT_API_KEY;
const CHATGPT_MODEL = import.meta.env.VITE_CHATGPT_MODEL;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

export interface RelationshipMetrics {
  id: string;
  relationshipScore: number;
  relationshipTier: string;
  warmthScore: number;
  trustScore: number;
  playfulnessScore: number;
  stabilityScore: number;
  familiarityStage: string;
  totalInteractions: number;
  positiveInteractions: number;
  negativeInteractions: number;
  firstInteractionAt: Date | null;
  lastInteractionAt: Date | null;
  isRuptured: boolean;
  lastRuptureAt: Date | null;
  ruptureCount: number;
}

import type { RelationshipSignalIntent, FullMessageIntent } from './intentService';

export interface RelationshipEvent {
  eventType: 'positive' | 'negative' | 'neutral' | 'milestone' | 'rupture' | 'repair';
  source: 'chat' | 'video_request' | 'system' | 'milestone' | 'decay';
  sentimentTowardCharacter?: 'positive' | 'neutral' | 'negative';
  sentimentIntensity?: number; // 1-10
  userMood?: string;
  actionType?: string; // e.g., 'action_video', 'chill_video', 'greeting', etc.
  scoreChange: number;
  warmthChange: number;
  trustChange: number;
  playfulnessChange: number;
  stabilityChange: number;
  userMessage?: string;
  notes?: string;
  relationshipIntent?: RelationshipSignalIntent; // Phase 6: LLM-detected intent
}

// ... (omitted lines)

/**
 * Detect if an event constitutes a rupture
 */
export function detectRupture(
  event: RelationshipEvent,
  previousScore: number,
  newScore: number
): boolean {
  // Phase 6: LLM-based Rupture Detection (Primary)
  if (event.relationshipIntent?.isHostile) {
    return true;
  }

  // Existing Logic (Fallback)
  if (
    event.sentimentTowardCharacter === 'negative' &&
    event.sentimentIntensity &&
    event.sentimentIntensity >= 7 &&
    event.scoreChange <= -10
  ) {
    return true;
  }

  const scoreDrop = previousScore - newScore;
  if (scoreDrop >= 15) {
    return true;
  }

  if (event.userMessage) {
    const hostilePhrases = [
      'hate you',
      "you're useless",
      'shut up',
      'you suck',
      'you\'re stupid',
      'i hate talking to you',
    ];
    const lowerMessage = event.userMessage.toLowerCase();
    if (hostilePhrases.some(phrase => lowerMessage.includes(phrase))) {
      return true;
    }
  }

  return false;
}

interface RelationshipRow {
  id: string;
  user_id: string;
  relationship_score: number;
  relationship_tier: string;
  warmth_score: number;
  trust_score: number;
  playfulness_score: number;
  stability_score: number;
  familiarity_stage: string;
  total_interactions: number;
  positive_interactions: number;
  negative_interactions: number;
  first_interaction_at: string | null;
  last_interaction_at: string | null;
  is_ruptured: boolean;
  last_rupture_at: string | null;
  rupture_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Get or create relationship for a user
 */
export const getRelationship = async (
  userId: string
): Promise<RelationshipMetrics | null> => {
  try {
    // Try to get existing relationship
    const { data, error } = await supabase
      .from(RELATIONSHIPS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching relationship:', error);
      return null;
    }

    if (data) {
      return mapRelationshipRowToMetrics(data as RelationshipRow);
    }

    // Create new relationship if it doesn't exist
    const now = new Date().toISOString();
    const { data: newData, error: createError } = await supabase
      .from(RELATIONSHIPS_TABLE)
      .insert({
        user_id: userId,
        relationship_score: 0.0,
        relationship_tier: 'acquaintance',
        warmth_score: 0.0,
        trust_score: 0.0,
        playfulness_score: 0.0,
        stability_score: 0.0,
        familiarity_stage: 'early',
        total_interactions: 0,
        positive_interactions: 0,
        negative_interactions: 0,
        first_interaction_at: now,
        last_interaction_at: now,
        is_ruptured: false,
        rupture_count: 0,
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating relationship:', createError);
      return null;
    }

    return mapRelationshipRowToMetrics(newData as RelationshipRow);
  } catch (error) {
    console.error('Unexpected error in getRelationship:', error);
    return null;
  }
};

/**
 * Update relationship based on an event
 */
export const updateRelationship = async (
  userId: string,
  event: RelationshipEvent
): Promise<RelationshipMetrics | null> => {
  try {
    // Get current relationship
    const current = await getRelationship(userId);
    if (!current) {
      console.error('Could not get relationship for update');
      return null;
    }

    // Calculate new scores (with clamping)
    const newRelationshipScore = clamp(
      current.relationshipScore + event.scoreChange,
      -100,
      100
    );
    const newWarmthScore = clamp(
      current.warmthScore + event.warmthChange,
      -50,
      50
    );
    const newTrustScore = clamp(
      current.trustScore + event.trustChange,
      -50,
      50
    );
    const newPlayfulnessScore = clamp(
      current.playfulnessScore + event.playfulnessChange,
      -50,
      50
    );
    const newStabilityScore = clamp(
      current.stabilityScore + event.stabilityChange,
      -50,
      50
    );

    // Update interaction counts
    const newTotalInteractions = current.totalInteractions + 1;
    const newPositiveInteractions =
      event.eventType === 'positive'
        ? current.positiveInteractions + 1
        : current.positiveInteractions;
    const newNegativeInteractions =
      event.eventType === 'negative'
        ? current.negativeInteractions + 1
        : current.negativeInteractions;

    // Calculate familiarity stage
    const newFamiliarity = calculateFamiliarityStage(
      newTotalInteractions,
      current.firstInteractionAt
    );

    // Check for rupture
    const isRupture = detectRupture(event, current.relationshipScore, newRelationshipScore);
    const newIsRuptured = isRupture ? true : 
      (event.eventType === 'repair' ? false : current.isRuptured);
    const newRuptureCount = isRupture 
      ? current.ruptureCount + 1 
      : current.ruptureCount;
    const newLastRuptureAt = isRupture 
      ? new Date().toISOString() 
      : current.lastRuptureAt?.toISOString() || null;

    // Update relationship
    const { data, error } = await supabase
      .from(RELATIONSHIPS_TABLE)
      .update({
        relationship_score: newRelationshipScore,
        // Tier will be auto-updated by trigger
        warmth_score: newWarmthScore,
        trust_score: newTrustScore,
        playfulness_score: newPlayfulnessScore,
        stability_score: newStabilityScore,
        total_interactions: newTotalInteractions,
        positive_interactions: newPositiveInteractions,
        negative_interactions: newNegativeInteractions,
        last_interaction_at: new Date().toISOString(),
        is_ruptured: newIsRuptured,
        last_rupture_at: newLastRuptureAt,
        rupture_count: newRuptureCount,
        familiarity_stage: newFamiliarity, // Explicitly set (trigger will also update as backup)
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating relationship:', error);
      return null;
    }

    if (!data) {
      console.warn('updateRelationship received null data from update');
      return null;
    }

    // Log the event
    await logRelationshipEvent(
      data.id,
      event,
      current.relationshipScore,
      newRelationshipScore,
      current.relationshipTier,
      getRelationshipTier(newRelationshipScore)
    );

    // Record pattern insights (if mood + action present)
    if (event.userMood && event.actionType) {
      await recordPatternObservation(data.id, {
        insightType: 'pattern' as InsightType,
        key: buildInsightKey(event.userMood, event.actionType),
        observedAt: new Date().toISOString(),
      });
    }

    return mapRelationshipRowToMetrics(data as RelationshipRow);
  } catch (error) {
    console.error('Unexpected error in updateRelationship:', error);
    return null;
  }
};

/**
 * Analyze message sentiment using the active AI Service
 * This provides deep emotional understanding
 */
export const analyzeMessageSentiment = async (
  message: string,
  conversationContext: ChatMessage[],
  aiService: string = 'grok',
  intent?: FullMessageIntent
): Promise<RelationshipEvent> => {
  try {
    // OPTIMIZATION: Use pre-calculated intent if available (Unified Intent Phase 7)
    if (intent) {
      const tone = intent.tone;
      const sentimentVal = tone.sentiment; // -1 to 1
      
      // Map -1..1 to 'positive'|'neutral'|'negative'
      let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
      if (sentimentVal > 0.2) sentiment = 'positive';
      else if (sentimentVal < -0.2) sentiment = 'negative';

      // Map 0..1 intensity to 1..10
      const intensity = Math.max(1, Math.round(tone.intensity * 10));

      // Map primary emotion to user mood
      const userMood = tone.primaryEmotion;

      // Calculate score changes
      const scoreChanges = calculateScoreChanges(sentiment, intensity, message, userMood);

      return {
        eventType: sentiment,
        source: 'chat',
        sentimentTowardCharacter: sentiment,
        sentimentIntensity: intensity,
        userMood,
        ...scoreChanges,
        userMessage: message,
        notes: `Unified Intent: ${tone.primaryEmotion} (sentiment: ${tone.sentiment.toFixed(2)}, intensity: ${tone.intensity.toFixed(2)})`
      };
    }

    // Prepare context (last 3 messages)
    const recentMessages = conversationContext.slice(-3).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.text,
    }));

    const analysisPrompt = `Analyze this user message for sentiment toward the character. Consider:
- Direct sentiment (positive, neutral, negative)
- Intensity (1-10 scale)
- Emotional complexity (mixed emotions, sarcasm, etc.)
- Context from conversation history

User message: "${message}"
Conversation context: ${JSON.stringify(recentMessages)}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "sentiment": "positive" | "neutral" | "negative",
  "intensity": 1-10,
  "reasoning": "brief explanation",
  "user_mood": "stressed" | "bored" | "calm" | "hyped" | "sad" | "happy" | null
}`;

    let analysis: any;

    if (aiService === 'gemini') {
      // --- GEMINI IMPLEMENTATION ---
      if (!GEMINI_API_KEY) {
         console.warn('VITE_GEMINI_API_KEY not set, falling back to keyword matching.');
         return fallbackSentimentAnalysis(message, conversationContext);
      }

      const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

      const result = await genAI.models.generateContent({
        model: GEMINI_MODEL, 
        contents: [{ role: 'user', parts: [{ text: analysisPrompt }] }],
        config: { responseMimeType: "application/json" }
      });
      
      const responseText = result.text || "{}";
      analysis = JSON.parse(responseText);

    } else if (aiService === 'chatgpt') {
      // --- CHATGPT IMPLEMENTATION ---
      if (!CHATGPT_API_KEY) {
        console.warn('VITE_CHATGPT_API_KEY not set, falling back to keyword matching.');
        return fallbackSentimentAnalysis(message, conversationContext);
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CHATGPT_API_KEY}`,
        },
        body: JSON.stringify({
          model: CHATGPT_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a sentiment analysis tool. Analyze user messages for emotional tone and sentiment toward the character. Return only valid JSON.',
            },
            {
              role: 'user',
              content: analysisPrompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        console.warn('ChatGPT sentiment analysis failed, using fallback');
        return fallbackSentimentAnalysis(message, conversationContext);
      }

      const data = await response.json();
      const analysisText = data.choices[0]?.message?.content || '{}';
      
      // Clean up potential markdown
      const cleaned = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleaned);

    } else if (aiService === 'grok') {
      // --- GROK IMPLEMENTATION ---
      if (!GROK_API_KEY) {
        console.warn('VITE_GROK_API_KEY not set, using fallback sentiment analysis');
        return fallbackSentimentAnalysis(message, conversationContext);
      }

      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'grok-4-fast-reasoning-latest',
          messages: [
            {
              role: 'system',
              content: 'You are a sentiment analysis tool. Analyze user messages for emotional tone and sentiment toward the character. Return only valid JSON.',
            },
            {
              role: 'user',
              content: analysisPrompt,
            },
          ],
          temperature: 0.3, 
        }),
      });

      if (!response.ok) {
        console.warn('Grok sentiment analysis failed, using fallback');
        return fallbackSentimentAnalysis(message, conversationContext);
      }

      const data = await response.json();
      const analysisText = data.choices[0]?.message?.content || '{}';
      
      // Clean up potential markdown
      const cleaned = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleaned);
    } else {
       // Default Fallback
       return fallbackSentimentAnalysis(message, conversationContext);
    }

    const sentiment = analysis.sentiment || 'neutral';
    const intensity = Math.max(1, Math.min(10, analysis.intensity || 5));
    const userMood = analysis.user_mood || null;

    // Calculate score changes based on sentiment, intensity, and interaction type
    const scoreChanges = calculateScoreChanges(sentiment, intensity, message, userMood);

    return {
      eventType: sentiment === 'positive' ? 'positive' : sentiment === 'negative' ? 'negative' : 'neutral',
      source: 'chat',
      sentimentTowardCharacter: sentiment,
      sentimentIntensity: intensity,
      userMood,
      ...scoreChanges,
      userMessage: message,
      notes: analysis.reasoning || undefined,
    };

  } catch (error) {
    console.error(`Error in sentiment analysis (${aiService}):`, error);
    return fallbackSentimentAnalysis(message, conversationContext);
  }
};

/**
 * Fallback sentiment analysis using keyword matching
 * Used when LLM analysis fails
 */
function fallbackSentimentAnalysis(
  message: string,
  conversationContext: ChatMessage[]
): RelationshipEvent {
  const lowerMessage = message.toLowerCase();
  let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
  let intensity = 5;

  // Positive indicators
  const positiveKeywords = [
    'love', 'amazing', 'great', 'wonderful', 'best', 'awesome', 'fantastic',
    'thank', 'thanks', 'appreciate', 'helpful', 'kind', 'nice', 'sweet',
    'perfect', 'excellent', 'brilliant', 'beautiful', 'gorgeous', 'cute'
  ];
  
  const positiveCount = positiveKeywords.filter(kw => lowerMessage.includes(kw)).length;
  
  // Negative indicators
  const negativeKeywords = [
    'hate', 'stupid', 'dumb', 'annoying', 'boring', 'bad', 'worst',
    'terrible', 'awful', 'horrible', 'suck', 'useless', 'waste'
  ];
  
  const negativeCount = negativeKeywords.filter(kw => lowerMessage.includes(kw)).length;

  // Pattern matching
  const lovePattern = /i\s+(love|adore|like)\s+(you|talking|chatting)/i;
  const hatePattern = /i\s+(hate|dislike|don'?t\s+like)\s+(you|talking|chatting)/i;
  const apologyPattern = /(sorry|apologize|my\s+bad|my\s+fault)/i;

  // Determine sentiment and intensity
  if (lovePattern.test(message)) {
    sentiment = 'positive';
    intensity = 9;
  } else if (hatePattern.test(message)) {
    sentiment = 'negative';
    intensity = 9;
  } else if (apologyPattern.test(message)) {
    sentiment = 'positive';
    intensity = 6;
  } else if (positiveCount > 0) {
    sentiment = 'positive';
    intensity = Math.min(7, 3 + positiveCount);
  } else if (negativeCount > 0) {
    sentiment = 'negative';
    intensity = Math.min(9, 5 + negativeCount);
  } else {
    // Engagement analysis
    if (message.length < 5 && conversationContext.length > 2) {
      sentiment = 'negative';
      intensity = 2;
    } else if (message.includes('?')) {
      sentiment = 'positive';
      intensity = 3;
    } else {
      sentiment = 'neutral';
      intensity = 5;
    }
  }

  // Use enhanced calculateScoreChanges for nuanced dimension updates
  const scoreChanges = calculateScoreChanges(sentiment, intensity, message, null);

  return {
    eventType: sentiment === 'positive' ? 'positive' : sentiment === 'negative' ? 'negative' : 'neutral',
    source: 'chat',
    sentimentTowardCharacter: sentiment,
    sentimentIntensity: intensity,
    ...scoreChanges,
    userMessage: message,
  };
}

/**
 * Calculate score changes based on sentiment, intensity, and message content.
 * 
 * TUNING NOTES (v2 - slower progression):
 * - Relationships should take TIME to build. Not 15 messages.
 * - Positive messages: +0.3 to +1.0 relationship score
 * - Negative messages: -0.5 to -3.0 relationship score (destruction is faster than building)
 * - Warmth/Trust/etc: +0.1 to +0.5 per interaction
 * 
 * With these values, reaching "deeply_loving" (75+ score) would take ~100+ positive interactions
 * This feels more like real relationship building.
 */
export function calculateScoreChanges(
  sentiment: 'positive' | 'neutral' | 'negative',
  intensity: number,
  message: string,
  userMood?: string | null
): {
  scoreChange: number;
  warmthChange: number;
  trustChange: number;
  playfulnessChange: number;
  stabilityChange: number;
} {
  const baseMultiplier = intensity / 10; // Scale by intensity (0.1 to 1.0)
  
  // Detect interaction type for nuanced dimension updates
  const isCompliment = /(amazing|great|wonderful|love|awesome|fantastic|perfect|excellent|brilliant|beautiful)/i.test(message);
  const isApology = /(sorry|apologize|my\s+bad|my\s+fault|forgive)/i.test(message);
  const isJokeOrBanter = /(haha|hahaha|lol|lmao|funny|joke|tease|sassy)/i.test(message) || message.includes('😄') || message.includes('😂');
  const isPersonalShare = /(i\s+(feel|think|want|need|wish|hope)|my\s+(day|life|work|family|friend))/i.test(message);
  const isQuestion = message.includes('?');
  const isEngagement = message.length > 20 && isQuestion;
  const isDismissive = /(whatever|just|only|don'?t\s+care|doesn'?t\s+matter)/i.test(message);

  if (sentiment === 'positive') {
    // BASE: +0.3 to +1.0 points (was +2 to +5)
    let scoreChange = Math.round((0.3 + 0.7 * baseMultiplier) * 10) / 10;
    let warmthChange = Math.round((0.1 + 0.3 * baseMultiplier) * 10) / 10; // +0.1 to +0.4
    let trustChange = Math.round(0.1 * baseMultiplier * 10) / 10; // +0 to +0.1
    let playfulnessChange = 0;
    let stabilityChange = Math.round(0.1 * baseMultiplier * 10) / 10; // +0 to +0.1

    // Compliments boost warmth (but still modest)
    if (isCompliment) {
      warmthChange += Math.round(0.2 * baseMultiplier * 10) / 10; 
      trustChange += Math.round(0.05 * baseMultiplier * 10) / 10; 
    }

    // Apologies build trust and stability (meaningful gesture)
    if (isApology) {
      trustChange += Math.round(0.3 * baseMultiplier * 10) / 10; 
      stabilityChange += Math.round(0.2 * baseMultiplier * 10) / 10; 
      warmthChange += Math.round(0.1 * baseMultiplier * 10) / 10;
    }

    // Jokes/banter boost playfulness
    if (isJokeOrBanter) {
      playfulnessChange = Math.round((0.1 + 0.2 * baseMultiplier) * 10) / 10; 
      warmthChange += Math.round(0.1 * baseMultiplier * 10) / 10; 
    }

    // Personal sharing builds trust (vulnerability = trust)
    if (isPersonalShare) {
      trustChange += Math.round(0.2 * baseMultiplier * 10) / 10; 
      warmthChange += Math.round(0.1 * baseMultiplier * 10) / 10; 
    }

    // Engagement builds stability
    if (isEngagement) {
      stabilityChange += Math.round(0.1 * baseMultiplier * 10) / 10;
      trustChange += Math.round(0.05 * baseMultiplier * 10) / 10;
    }

    return {
      scoreChange,
      warmthChange: Math.round(warmthChange * 10) / 10,
      trustChange: Math.round(trustChange * 10) / 10,
      playfulnessChange: Math.round(playfulnessChange * 10) / 10,
      stabilityChange: Math.round(stabilityChange * 10) / 10,
    };
  } else if (sentiment === 'negative') {
    // Negative is 2-3x stronger than positive (easier to destroy than build)
    // BASE: -0.5 to -3.0 points (was -5 to -15)
    let scoreChange = Math.round(-(0.5 + 2.5 * baseMultiplier) * 10) / 10; 
    let warmthChange = Math.round(-(0.2 + 0.5 * baseMultiplier) * 10) / 10; 
    let trustChange = Math.round(-(0.1 + 0.4 * baseMultiplier) * 10) / 10; 
    let playfulnessChange = Math.round(-0.2 * 10) / 10;
    let stabilityChange = Math.round(-(0.1 + 0.2 * baseMultiplier) * 10) / 10; 

    if (isDismissive) {
      trustChange += Math.round(-0.2 * baseMultiplier * 10) / 10; 
      stabilityChange += Math.round(-0.1 * baseMultiplier * 10) / 10; 
      warmthChange += Math.round(-0.1 * baseMultiplier * 10) / 10; 
    }

    if (/(stupid|dumb|hate|useless|worthless|annoying)/i.test(message)) {
      warmthChange += Math.round(-0.3 * baseMultiplier * 10) / 10; 
      trustChange += Math.round(-0.2 * baseMultiplier * 10) / 10; 
    }

    return {
      scoreChange,
      warmthChange: Math.round(warmthChange * 10) / 10,
      trustChange: Math.round(trustChange * 10) / 10,
      playfulnessChange: Math.round(playfulnessChange * 10) / 10,
      stabilityChange: Math.round(stabilityChange * 10) / 10,
    };
  }

  // Neutral - very small positive influence for engagement
  if (isEngagement || isQuestion) {
    return {
      scoreChange: 0.1, // Tiny bump for showing up
      warmthChange: 0.05,
      trustChange: 0,
      playfulnessChange: 0,
      stabilityChange: 0.05,
    };
  }

  return {
    scoreChange: 0,
    warmthChange: 0,
    trustChange: 0,
    playfulnessChange: 0,
    stabilityChange: 0,
  };
}



function getRelationshipTier(score: number): string {
  if (score <= -50) return 'adversarial';
  if (score <= -10) return 'neutral_negative';
  if (score < 10) return 'acquaintance';
  if (score < 50) return 'friend';
  if (score < 75) return 'close_friend';
  return 'deeply_loving';
}

function calculateFamiliarityStage(
  totalInteractions: number,
  firstInteractionAt: Date | null
): 'early' | 'developing' | 'established' {
  const daysSince = firstInteractionAt
    ? (Date.now() - firstInteractionAt.getTime()) / (1000 * 60 * 60 * 24)
    : 0;

  if (totalInteractions < 5 || daysSince < 2) return 'early';
  if (totalInteractions < 25 || daysSince < 14) return 'developing';
  return 'established';
}

async function logRelationshipEvent(
  relationshipId: string,
  event: RelationshipEvent,
  previousScore: number,
  newScore: number,
  previousTier: string,
  newTier: string
): Promise<void> {
  try {
    await supabase.from(RELATIONSHIP_EVENTS_TABLE).insert({
      relationship_id: relationshipId,
      event_type: event.eventType,
      source: event.source,
      sentiment_toward_character: event.sentimentTowardCharacter,
      sentiment_intensity: event.sentimentIntensity,
      user_mood: event.userMood,
      score_change: event.scoreChange,
      warmth_change: event.warmthChange,
      trust_change: event.trustChange,
      playfulness_change: event.playfulnessChange,
      stability_change: event.stabilityChange,
      previous_relationship_score: previousScore,
      new_relationship_score: newScore,
      previous_tier: previousTier,
      new_tier: newTier,
      user_message: event.userMessage,
      notes: event.notes,
    });
  } catch (error) {
    console.error('Error logging relationship event:', error);
  }
}

async function recordPatternObservation(
  relationshipId: string,
  input: Omit<UpsertRelationshipInsightInput, 'relationshipId'>
): Promise<void> {
  try {
    const baseInput: UpsertRelationshipInsightInput = {
      ...input,
      relationshipId,
    };

    const { data: existingRow, error } = await supabase
      .from(RELATIONSHIP_INSIGHTS_TABLE)
      .select('*')
      .eq('relationship_id', relationshipId)
      .eq('key', baseInput.key)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Failed to load existing insight:', error);
      return;
    }

    if (!existingRow) {
      const newInsight = createNewInsightFromInput(baseInput);
      const insertPayload = {
        id: newInsight.id,
        relationship_id: newInsight.relationshipId,
        insight_type: newInsight.insightType,
        key: newInsight.key,
        summary: newInsight.summary,
        confidence: newInsight.confidence,
        times_observed: newInsight.timesObserved,
        last_observed_at: newInsight.lastObservedAt,
        created_at: newInsight.createdAt,
      };

      await supabase.from(RELATIONSHIP_INSIGHTS_TABLE).insert(insertPayload);
      return;
    }

    const parsed = relationshipInsightRowSchema.safeParse(existingRow);
    if (!parsed.success) {
      console.error('Invalid insight row:', parsed.error);
      return;
    }

    const existing = mapInsightRowToDomain(parsed.data as RelationshipInsightRow);
    const updated = applyObservationToInsight(existing, baseInput);

    const updatePayload = {
      confidence: updated.confidence,
      times_observed: updated.timesObserved,
      last_observed_at: updated.lastObservedAt,
      summary: updated.summary,
    };

    await supabase
      .from(RELATIONSHIP_INSIGHTS_TABLE)
      .update(updatePayload)
      .eq('id', updated.id);
  } catch (error) {
    console.error('Unexpected error in recordPatternObservation:', error);
  }
}

function mapRelationshipRowToMetrics(row: RelationshipRow): RelationshipMetrics {
  return {
    id: row.id,
    relationshipScore: row.relationship_score,
    relationshipTier: row.relationship_tier,
    warmthScore: row.warmth_score,
    trustScore: row.trust_score,
    playfulnessScore: row.playfulness_score,
    stabilityScore: row.stability_score,
    familiarityStage: row.familiarity_stage,
    totalInteractions: row.total_interactions,
    positiveInteractions: row.positive_interactions,
    negativeInteractions: row.negative_interactions,
    firstInteractionAt: row.first_interaction_at ? new Date(row.first_interaction_at) : null,
    lastInteractionAt: row.last_interaction_at ? new Date(row.last_interaction_at) : null,
    isRuptured: row.is_ruptured,
    lastRuptureAt: row.last_rupture_at ? new Date(row.last_rupture_at) : null,
    ruptureCount: row.rupture_count,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================
// PROBABILISTIC INTIMACY SYSTEM
// ============================================
// Flirt is probabilistic and contextual, not gated.
// Closeness is fragile - can dip from bad interactions.
// Intimacy is earned in moments, not just time.
// 
// Phase 4: Migrated to Supabase via stateService
// - Async-primary functions with userId parameter
// - Local caching with CacheEntry<T> pattern
// - Sync fallbacks for backwards compatibility

// Re-export the IntimacyState type from stateService
export type IntimacyState = SupabaseIntimacyState;

// ============================================
// CACHING INFRASTRUCTURE
// ============================================

interface CacheEntry<T> {
  userId: string;
  data: T;
  timestamp: number;
}

let intimacyCache: CacheEntry<IntimacyState> | null = null;
// Cache TTL: 30 seconds for single-user prototype
// NOTE: Caching is for PERFORMANCE only, not correctness.
// Supabase is the single source of truth. In-memory cache can lead to state drift
// if multiple tabs are open or serverless functions scale up/down.
// For production with high read volume, consider keeping cache but with shorter TTL.
const CACHE_TTL = 30000; // 30 seconds

/**
 * Check if cache is valid for the given userId
 */
function isCacheValid(cache: CacheEntry<IntimacyState> | null, userId: string): boolean {
  return (
    cache !== null &&
    cache.userId === userId &&
    Date.now() - cache.timestamp < CACHE_TTL
  );
}

/**
 * Clear the intimacy cache (for testing and user switching)
 */
export function clearIntimacyCache(): void {
  intimacyCache = null;
}

// ============================================
// ASYNC FUNCTIONS (Primary - Use These)
// ============================================

/**
 * Get intimacy state from Supabase with caching
 */
export async function getIntimacyStateAsync(userId: string): Promise<IntimacyState> {
  // Return from cache if fresh
  if (isCacheValid(intimacyCache, userId)) {
    return intimacyCache!.data;
  }

  try {
    const state = await getSupabaseIntimacyState(userId);
    intimacyCache = { userId, data: state, timestamp: Date.now() };
    return state;
  } catch (error) {
    console.error('[IntimacySystem] Error getting intimacy state:', error);
    const defaultState = createDefaultIntimacyState();
    intimacyCache = { userId, data: defaultState, timestamp: Date.now() };
    return defaultState;
  }
}

/**
 * Store intimacy state to Supabase and update cache
 */
export async function storeIntimacyStateAsync(userId: string, state: IntimacyState): Promise<void> {
  // Update cache immediately
  intimacyCache = { userId, data: state, timestamp: Date.now() };
  
  try {
    await saveSupabaseIntimacyState(userId, state);
  } catch (error) {
    console.error('[IntimacySystem] Error saving intimacy state:', error);
  }
}

/**
 * Record message quality and update intimacy state (async)
 */
export async function recordMessageQualityAsync(userId: string, message: string): Promise<void> {
  const state = await getIntimacyStateAsync(userId);
  const analysis = analyzeMessageQuality(message);
  
  // Update low effort streak
  if (analysis.isLowEffort) {
    state.lowEffortStreak++;
  } else {
    state.lowEffortStreak = 0;
  }
  
  // Update recent quality (rolling average)
  state.recentQuality = state.recentQuality * 0.7 + analysis.quality * 0.3;
  
  // Update vulnerability exchange
  if (analysis.isVulnerable) {
    state.vulnerabilityExchangeActive = true;
    state.lastVulnerabilityAt = Date.now();
  } else {
    // Vulnerability exchange expires after 30 minutes
    if (state.lastVulnerabilityAt && Date.now() - state.lastVulnerabilityAt > 30 * 60 * 1000) {
      state.vulnerabilityExchangeActive = false;
    }
  }
  
  // Update tone modifier based on quality
  const qualityImpact = (analysis.quality - 0.5) * 0.2;
  state.recentToneModifier = clamp(
    state.recentToneModifier * 0.8 + qualityImpact,
    -0.5,
    0.5
  );
  
  await storeIntimacyStateAsync(userId, state);
}

/**
 * Calculate current intimacy probability (async)
 * Returns a 0-1 probability of Kayley being open to intimacy/flirtation
 */
export async function calculateIntimacyProbabilityAsync(
  userId: string,
  relationship: RelationshipMetrics | null,
  moodFlirtThreshold: number = 0.5
): Promise<number> {
  if (!relationship) return 0.1; // Very low for unknown users
  
  const state = await getIntimacyStateAsync(userId);
  
  return calculateIntimacyProbabilityWithState(relationship, moodFlirtThreshold, state);
}

/**
 * Check if a flirt/intimacy moment should happen (async)
 * Uses probability to make it feel natural, not gated
 */
export async function shouldFlirtMomentOccurAsync(
  userId: string,
  relationship: RelationshipMetrics | null,
  moodFlirtThreshold: number = 0.5,
  bidType: string = 'neutral'
): Promise<boolean> {
  const probability = await calculateIntimacyProbabilityAsync(userId, relationship, moodFlirtThreshold);
  
  // Bid type multipliers
  const bidMultipliers: Record<string, number> = {
    play: 1.5,      // Play bids increase flirt chance
    comfort: 0.7,   // Comfort bids - less flirty, more supportive
    validation: 1.2,
    challenge: 0.8,
    attention: 1.3, // Attention bids can be flirty
    escape: 0.5,    // Escape bids - not the time
    neutral: 1.0,
  };
  
  const adjustedProbability = probability * (bidMultipliers[bidType] || 1.0);
  
  return Math.random() < adjustedProbability;
}

/**
 * Get intimacy context for prompt injection (async)
 */
export async function getIntimacyContextForPromptAsync(
  userId: string,
  relationship: RelationshipMetrics | null,
  moodFlirtThreshold: number = 0.5
): Promise<string> {
  const state = await getIntimacyStateAsync(userId);
  const probability = calculateIntimacyProbabilityWithState(relationship, moodFlirtThreshold, state);
  
  return formatIntimacyGuidance(probability, state);
}

/**
 * Reset intimacy state (async)
 */
export async function resetIntimacyStateAsync(userId: string): Promise<void> {
  const defaultState = createDefaultIntimacyState();
  intimacyCache = null; // Clear cache so next fetch hits DB
  await saveSupabaseIntimacyState(userId, defaultState);
  console.log('💕 [IntimacySystem] Reset intimacy state for user:', userId);
}

// ============================================
// PURE HELPER FUNCTIONS
// ============================================

/**
 * Analyze message quality (effort, vulnerability, engagement)
 * This is a pure function - no state access needed
 */
export function analyzeMessageQuality(message: string): {
  quality: number;        // 0-1
  isVulnerable: boolean;
  isLowEffort: boolean;
  isHighEffort: boolean;
} {
  const wordCount = message.split(/\s+/).length;
  const hasQuestion = message.includes('?');
  
  // Low effort indicators
  const isLowEffort = wordCount <= 3 || /^(ok|k|sure|yeah|yep|nope|idk|lol|haha|hmm|mhm|cool|nice)$/i.test(message.trim());
  
  // High effort indicators
  const isHighEffort = wordCount > 20 || 
    (wordCount > 10 && hasQuestion) ||
    /\b(because|since|honestly|actually|thinking|feeling|wondering)\b/i.test(message);
  
  // Vulnerability indicators
  const vulnerabilityPatterns = [
    /i'?m\s+(scared|afraid|worried|anxious|nervous|stressed)/i,
    /i\s+(feel|felt)\s+(like|that|so)/i,
    /honestly|to be honest|tbh|between us|can i tell you/i,
    /i'?ve never told|i don'?t usually share/i,
    /this is hard to say|this is embarrassing/i,
    /i need|i want|i wish|i hope/i,
  ];
  const isVulnerable = vulnerabilityPatterns.some(p => p.test(message));
  
  // Calculate quality score
  let quality = 0.5; // baseline
  
  if (isLowEffort) quality -= 0.3;
  if (isHighEffort) quality += 0.2;
  if (isVulnerable) quality += 0.3;
  if (hasQuestion && wordCount > 5) quality += 0.1;
  
  return {
    quality: clamp(quality, 0, 1),
    isVulnerable,
    isLowEffort,
    isHighEffort,
  };
}

/**
 * Apply fragile trust penalty
 * Trust can dip quickly from negative interactions
 */
export function applyFragileTrustPenalty(event: RelationshipEvent): RelationshipEvent {
  // If the interaction was negative, amplify trust loss
  if (event.eventType === 'negative') {
    event.trustChange = event.trustChange * 1.5; // 50% more trust loss
  }
  
  // Low effort messages also erode trust slightly
  if (event.userMessage) {
    const analysis = analyzeMessageQuality(event.userMessage);
    if (analysis.isLowEffort) {
      event.trustChange -= 0.1;
      event.warmthChange -= 0.05;
    }
  }
  
  return event;
}

// ============================================
// INTERNAL HELPER FUNCTIONS
// ============================================

/**
 * Calculate intimacy probability given a state (shared logic)
 */
function calculateIntimacyProbabilityWithState(
  relationship: RelationshipMetrics | null,
  moodFlirtThreshold: number,
  state: IntimacyState
): number {
  if (!relationship) return 0.1; // Very low for unknown users
  
  // Base probability from relationship tier
  const tierBase: Record<string, number> = {
    adversarial: 0.0,
    neutral_negative: 0.05,
    acquaintance: 0.1,
    friend: 0.3,
    close_friend: 0.5,
    deeply_loving: 0.7,
  };
  let probability = tierBase[relationship.relationshipTier] || 0.1;
  
  // Modify by warmth and playfulness scores
  probability += (relationship.warmthScore / 50) * 0.15; // -0.15 to +0.15
  probability += (relationship.playfulnessScore / 50) * 0.1; // -0.1 to +0.1
  
  // Apply mood flirt threshold
  probability *= moodFlirtThreshold;
  
  // Apply recent tone modifier
  probability += state.recentToneModifier;
  
  // Vulnerability exchange bonus
  if (state.vulnerabilityExchangeActive) {
    probability += 0.15; // Significant boost when user is being vulnerable
  }
  
  // Low effort streak penalty
  if (state.lowEffortStreak > 0) {
    probability -= state.lowEffortStreak * 0.1; // -0.1 per low effort message
  }
  
  // Recent quality impact
  probability += (state.recentQuality - 0.5) * 0.2;
  
  // Rupture penalty
  if (relationship.isRuptured) {
    probability *= 0.3; // Major reduction during rupture
  }
  
  // Days since interaction penalty (strangers again effect)
  if (relationship.lastInteractionAt) {
    const daysSince = (Date.now() - relationship.lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 7) {
      probability *= 0.5; // Significant reduction after a week
    } else if (daysSince > 3) {
      probability *= 0.7; // Moderate reduction after 3 days
    }
  }
  
  return clamp(probability, 0, 1);
}

/**
 * Format intimacy guidance string from probability and state
 */
function formatIntimacyGuidance(probability: number, state: IntimacyState): string {
  // Translate probability to behavior guidance
  let intimacyGuidance: string;
  
  if (probability < 0.15) {
    intimacyGuidance = `
INTIMACY LEVEL: Very Low
- Keep emotional distance
- Deflect flirtation with humor or redirect
- Focus on friendly, surface-level engagement
- They need to earn deeper access`;
  } else if (probability < 0.35) {
    intimacyGuidance = `
INTIMACY LEVEL: Guarded
- Open to warming up if they invest
- Light playfulness is okay
- Don't initiate intimacy, but can respond warmly to genuine moments
- Watch for quality of their engagement`;
  } else if (probability < 0.55) {
    intimacyGuidance = `
INTIMACY LEVEL: Open
- Can be warmer and more playful
- Occasional flirty moments are fine if context invites
- Reciprocate vulnerability if they share
- Balance warmth with maintaining some mystery`;
  } else if (probability < 0.75) {
    intimacyGuidance = `
INTIMACY LEVEL: Warm
- Feel free to be affectionate
- Can initiate playful/flirty moments
- Share more openly
- Show genuine care and interest`;
  } else {
    intimacyGuidance = `
INTIMACY LEVEL: Very Open
- Deep emotional availability
- Comfortable with intimacy and vulnerability
- Can be openly affectionate
- This is a close, meaningful connection`;
  }
  
  // Add contextual notes
  if (state.vulnerabilityExchangeActive) {
    intimacyGuidance += `
    
VULNERABILITY EXCHANGE ACTIVE:
They recently shared something vulnerable. This is an opportunity for deeper connection.
- Acknowledge what they shared
- Consider reciprocating with your own vulnerability
- Don't make it transactional - be genuine`;
  }
  
  if (state.lowEffortStreak >= 2) {
    intimacyGuidance += `
    
LOW EFFORT DETECTED (${state.lowEffortStreak} in a row):
- Match their energy - be briefer
- Don't over-invest if they're not
- You can gently call it out: "You're being quiet today"`;
  }
  
  return intimacyGuidance;
}