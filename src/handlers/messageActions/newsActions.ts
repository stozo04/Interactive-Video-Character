/**
 * News Actions Handler
 *
 * Processes news-related actions from AI responses.
 * Fetches and formats tech news from Hacker News.
 *
 * Extracted from App.tsx as part of Phase 5 refactoring.
 */

import {
  fetchTechNews,
  markStoryMentioned,
  storeLastSharedStories,
  type HNStory,
} from '../../services/newsService';

/**
 * News action from AI response
 */
export interface NewsAction {
  action: 'fetch';
}

/**
 * Result of processing a news action
 */
export interface NewsActionResult {
  handled: boolean;
  stories: HNStory[];
  newsPrompt: string;
  error?: string;
}

/**
 * Process a news action from AI response
 */
export async function processNewsAction(
  newsAction: NewsAction | null | undefined
): Promise<NewsActionResult> {
  if (!newsAction || newsAction.action !== 'fetch') {
    return { handled: false, stories: [], newsPrompt: '' };
  }

  console.log('📰 News action detected - fetching latest tech news');

  try {
    const stories = await fetchTechNews();

    if (stories.length > 0) {
      // Store stories for follow-up questions
      const sharedStories = stories.slice(0, 3);
      storeLastSharedStories(sharedStories);

      // Mark stories as mentioned
      sharedStories.forEach((story) => markStoryMentioned(story.id));

      // Build news prompt for AI
      const newsPrompt = buildNewsPrompt(stories);

      return {
        handled: true,
        stories: sharedStories,
        newsPrompt,
      };
    } else {
      // No news found
      const noNewsPrompt = `
[SYSTEM EVENT: NEWS_FETCHED]
I checked Hacker News but didn't find any super relevant AI/tech stories right now.
Let the user know in a friendly way and maybe offer to check back later.
      `.trim();

      return {
        handled: true,
        stories: [],
        newsPrompt: noNewsPrompt,
      };
    }
  } catch (error) {
    console.error('Failed to fetch news:', error);
    return {
      handled: false,
      stories: [],
      newsPrompt: '',
      error: error instanceof Error ? error.message : 'Failed to fetch news',
    };
  }
}

/**
 * Build the news prompt for AI to present to user
 */
function buildNewsPrompt(stories: HNStory[]): string {
  const newsItems = formatNewsForAI(stories);

  return `
[SYSTEM EVENT: NEWS_FETCHED]
Here are the latest trending AI/tech stories from Hacker News:

${newsItems}

Your goal: Share these news stories with the user in your signature style.
- Pick 1-2 that seem most interesting
- Translate tech jargon into human terms
- Be enthusiastic and conversational
- Ask if they want to hear more about any of them
- Keep it natural (2-3 sentences)

IMPORTANT: You have the URLs above. If the user asks for a link or wants to read more:
- Share the URL directly in your response
- Example: "Here's the link: [URL]"
- You can also offer to share the Hacker News discussion: https://news.ycombinator.com/item?id=[story.id]
  `.trim();
}

/**
 * Format news stories for AI consumption
 */
export function formatNewsForAI(stories: HNStory[]): string {
  return stories
    .slice(0, 3)
    .map((story, i) => {
      const hostname = story.url ? new URL(story.url).hostname : 'Hacker News';
      const url = story.url || `https://news.ycombinator.com/item?id=${story.id}`;
      return `${i + 1}. "${story.title}"
   Source: ${hostname}
   URL: ${url}
   Score: ${story.score} upvotes`;
    })
    .join('\n\n');
}
