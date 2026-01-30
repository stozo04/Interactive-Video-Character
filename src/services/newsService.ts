// src/services/newsService.ts

/**
 * Hacker News Service
 * Fetches AI/tech news for Kayley to discuss during idle check-ins
 */

export interface HNStory {
  id: number;
  title: string;
  url?: string;
  score: number;
  by: string;
  time: number;
}

const CACHE_KEY = 'kayley_news_cache';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour
const MENTIONED_KEY = 'kayley_mentioned_stories';
const LAST_SHARED_KEY = 'kayley_last_shared_stories';

// Keywords to filter for AI/tech relevance
const AI_TECH_KEYWORDS = [
  'ai', 'gpt', 'llm', 'chatgpt', 'claude', 'gemini', 'copilot',
  'machine learning', 'neural', 'deep learning',
  'openai', 'anthropic', 'google', 'microsoft', 'apple', 'meta',
  'startup', 'programming', 'developer', 'software', 'tech',
  'robot', 'automation', 'autonomous'
];

interface CachedNews {
  stories: HNStory[];
  timestamp: number;
}

/**
 * Fetch top AI/tech stories from Hacker News
 * Results are cached for 1 hour
 */
export async function fetchTechNews(): Promise<HNStory[]> {
  // Check cache first
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      const { stories, timestamp }: CachedNews = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        console.log('📰 Using cached news stories');
        return stories;
      }
    } catch (e) {
      console.warn('Failed to parse cached news, fetching fresh');
    }
  }
  
  try {
    // Fetch top story IDs
    const topIds: number[] = await fetch(
      'https://hacker-news.firebaseio.com/v0/topstories.json'
    ).then(r => r.json());
    
    // Fetch details for top 30 stories
    const storyPromises = topIds.slice(0, 30).map((id: number) => 
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        .then(r => r.json())
        .catch(() => null) // Handle individual fetch failures gracefully
    );
    
    const stories: (HNStory | null)[] = await Promise.all(storyPromises);
    
    // Filter for AI/tech relevance
    const filtered = stories
      .filter((s): s is HNStory => 
        s !== null && 
        s.title !== undefined &&
        AI_TECH_KEYWORDS.some(kw => s.title.toLowerCase().includes(kw))
      )
      .slice(0, 5);
    
    // Cache results
    const cacheData: CachedNews = { stories: filtered, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    
    console.log(`📰 Fetched ${filtered.length} AI/tech stories from Hacker News`);
    return filtered;
  } catch (error) {
    console.error('Error fetching tech news:', error);
    return [];
  }
}

/**
 * Get a random story that hasn't been mentioned recently
 */
export function getUnmentionedStory(stories: HNStory[]): HNStory | null {
  if (stories.length === 0) return null;
  
  const mentionedRaw = localStorage.getItem(MENTIONED_KEY);
  const mentioned = new Set<number>(mentionedRaw ? JSON.parse(mentionedRaw) : []);
  const unmentioned = stories.filter(s => !mentioned.has(s.id));
  
  if (unmentioned.length === 0) {
    // Reset if all have been mentioned
    localStorage.setItem(MENTIONED_KEY, '[]');
    return stories[0];
  }
  
  return unmentioned[Math.floor(Math.random() * unmentioned.length)];
}

/**
 * Mark a story as mentioned to avoid repetition
 */
export function markStoryMentioned(storyId: number): void {
  const mentionedRaw = localStorage.getItem(MENTIONED_KEY);
  const mentioned: number[] = mentionedRaw ? JSON.parse(mentionedRaw) : [];
  mentioned.push(storyId);
  // Keep only last 20 to avoid growing forever
  localStorage.setItem(MENTIONED_KEY, JSON.stringify(mentioned.slice(-20)));
}

/**
 * Store the stories that were just shared with the user
 * This allows follow-up questions like "tell me more about #1"
 */
export function storeLastSharedStories(stories: HNStory[]): void {
  localStorage.setItem(LAST_SHARED_KEY, JSON.stringify({
    stories,
    timestamp: Date.now()
  }));
  console.log(`📰 Stored ${stories.length} stories for follow-up questions`);
}

/**
 * Get the stories that were recently shared
 * Returns null if older than 30 minutes
 */
export function getLastSharedStories(): HNStory[] | null {
  const stored = localStorage.getItem(LAST_SHARED_KEY);
  if (!stored) return null;
  
  try {
    const { stories, timestamp } = JSON.parse(stored);
    // Stories are valid for 30 minutes
    if (Date.now() - timestamp > 30 * 60 * 1000) {
      return null;
    }
    return stories;
  } catch {
    return null;
  }
}

/**
 * Build a context string of recently shared stories for the AI prompt
 */
export function getRecentNewsContext(): string {
  const stories = getLastSharedStories();
  if (!stories || stories.length === 0) return '';
  
  const newsItems = stories.map((story) => {
    const hostname = story.url ? new URL(story.url).hostname.replace('www.', '') : 'Hacker News';
    return `• "${story.title}" (${hostname})\n  Link: ${story.url || 'N/A'}\n  Discussion: https://news.ycombinator.com/item?id=${story.id}`;
  }).join('\n');
  
  return `
====================================================
RECENTLY SHARED CONTEXT
====================================================
Tone: Helpful but casual.
Direction: You recently brought up these stories. If the conversation circles back to them or the user asks for a source, you have the "receipts" ready. Drop the links naturally without being robotic about it.

Your Recent Shares:
${newsItems}
`;
}

/**
 * Clear the news cache (useful for testing)
 */
export function clearNewsCache(): void {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(MENTIONED_KEY);
  localStorage.removeItem(LAST_SHARED_KEY);
  console.log('📰 News cache cleared');
}

