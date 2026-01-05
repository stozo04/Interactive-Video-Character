import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processNewsAction,
  formatNewsForAI,
  NewsActionResult,
} from '../newsActions';

// Mock newsService
vi.mock('../../../services/newsService', () => ({
  fetchTechNews: vi.fn().mockResolvedValue([
    {
      id: 1,
      title: 'AI Breakthrough in Language Models',
      url: 'https://example.com/ai-news',
      score: 500,
    },
    {
      id: 2,
      title: 'New JavaScript Framework Released',
      url: 'https://example.com/js-news',
      score: 350,
    },
    {
      id: 3,
      title: 'Quantum Computing Update',
      url: 'https://example.com/quantum',
      score: 200,
    },
  ]),
  markStoryMentioned: vi.fn(),
  storeLastSharedStories: vi.fn(),
}));

describe('newsActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processNewsAction', () => {
    it('should fetch news when action is "fetch"', async () => {
      const newsAction = {
        action: 'fetch' as const,
      };

      const result = await processNewsAction(newsAction);

      expect(result.handled).toBe(true);
      expect(result.stories).toHaveLength(3);
      expect(result.newsPrompt).toContain('AI Breakthrough');
    });

    it('should return not handled for null action', async () => {
      const result = await processNewsAction(null);

      expect(result.handled).toBe(false);
    });

    it('should return not handled for non-fetch action', async () => {
      const newsAction = {
        action: 'something_else' as const,
      };

      const result = await processNewsAction(newsAction as any);

      expect(result.handled).toBe(false);
    });

    it('should handle empty news results', async () => {
      const { fetchTechNews } = await import('../../../services/newsService');
      vi.mocked(fetchTechNews).mockResolvedValueOnce([]);

      const newsAction = { action: 'fetch' as const };

      const result = await processNewsAction(newsAction);

      expect(result.handled).toBe(true);
      expect(result.stories).toHaveLength(0);
      expect(result.newsPrompt).toContain("didn't find any");
    });

    it('should handle fetch errors gracefully', async () => {
      const { fetchTechNews } = await import('../../../services/newsService');
      vi.mocked(fetchTechNews).mockRejectedValueOnce(new Error('Network error'));

      const newsAction = { action: 'fetch' as const };

      const result = await processNewsAction(newsAction);

      expect(result.handled).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('formatNewsForAI', () => {
    it('should format stories with URLs and scores', () => {
      const stories = [
        {
          id: 1,
          title: 'Test Story',
          url: 'https://example.com/story',
          score: 100,
        },
      ];

      const result = formatNewsForAI(stories);

      expect(result).toContain('Test Story');
      expect(result).toContain('example.com');
      expect(result).toContain('100 upvotes');
      expect(result).toContain('https://example.com/story');
    });

    it('should handle stories without URLs', () => {
      const stories = [
        {
          id: 123,
          title: 'HN Discussion',
          url: '',
          score: 50,
        },
      ];

      const result = formatNewsForAI(stories);

      expect(result).toContain('HN Discussion');
      expect(result).toContain('https://news.ycombinator.com/item?id=123');
    });

    it('should limit to 3 stories', () => {
      const stories = [
        { id: 1, title: 'Story 1', url: 'https://a.com', score: 100 },
        { id: 2, title: 'Story 2', url: 'https://b.com', score: 90 },
        { id: 3, title: 'Story 3', url: 'https://c.com', score: 80 },
        { id: 4, title: 'Story 4', url: 'https://d.com', score: 70 },
        { id: 5, title: 'Story 5', url: 'https://e.com', score: 60 },
      ];

      const result = formatNewsForAI(stories);

      expect(result).toContain('Story 1');
      expect(result).toContain('Story 2');
      expect(result).toContain('Story 3');
      expect(result).not.toContain('Story 4');
      expect(result).not.toContain('Story 5');
    });
  });
});
