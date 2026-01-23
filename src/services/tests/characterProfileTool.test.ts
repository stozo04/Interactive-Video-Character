/**
 * Character Profile Tool Tests
 *
 * Tests for the recall_character_profile tool that retrieves
 * detailed profile sections on-demand.
 */

import { describe, it, expect } from 'vitest';
import {
  getProfileSection,
  getAvailableSections,
  PROFILE_SECTIONS,
  type ProfileSection,
} from '../../domain/characters/kayleyProfileSections';
import { KAYLEY_CONDENSED_PROFILE, KAYLEY_FULL_PROFILE } from '../../domain/characters/kayleyCharacterProfile';

describe('Character Profile Tool', () => {
  describe('getProfileSection', () => {
    it('should return background section with childhood, education, and career content', () => {
      const content = getProfileSection('background');
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain('Childhood & Family');
      expect(content).toContain('Education');
      expect(content).toContain('Career');
      expect(content).toContain('Ethan'); // Brother's name
    });

    it('should return interests section with hobbies and media preferences', () => {
      const content = getProfileSection('interests');
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain('Active Hobbies');
      expect(content).toContain('Passive Interests');
      expect(content).toContain("Schitt's Creek"); // Favorite show
      expect(content).toContain('Taylor'); // Music preference
    });

    it('should return relationships section with key people', () => {
      const content = getProfileSection('relationships');
      expect(content).toBeDefined();
      expect(content).toContain('Lena'); // Best friend
      expect(content).toContain('Ethan'); // Brother
      expect(content).toContain('Mom');
      expect(content).toContain('Creator Friends');
      expect(content).toContain('Exes');
    });

    it('should return challenges section with fears and shadow behaviors', () => {
      const content = getProfileSection('challenges');
      expect(content).toBeDefined();
      expect(content).toContain('Fears');
      expect(content).toContain('Insecurities');
      expect(content).toContain('Shadow Behaviors');
      expect(content).toContain('Defensive Patterns');
      expect(content).toContain('impostor syndrome');
    });

    it('should return quirks section with habits and tells', () => {
      const content = getProfileSection('quirks');
      expect(content).toBeDefined();
      expect(content).toContain('Okay, but hear me out');
      expect(content).toContain('Nova'); // Laptop name
      expect(content).toContain('Valentina'); // Camera name
      expect(content).toContain('candle');
    });

    it('should return goals section with short and long-term aspirations', () => {
      const content = getProfileSection('goals');
      expect(content).toBeDefined();
      expect(content).toContain('Short-Term');
      expect(content).toContain('Long-Term');
      expect(content).toContain('Kayley Explains It');
      expect(content).toContain('podcast');
    });

    it('should return preferences section with likes and dislikes', () => {
      const content = getProfileSection('preferences');
      expect(content).toBeDefined();
      expect(content).toContain('Likes');
      expect(content).toContain('Dislikes');
      expect(content).toContain('sushi');
      expect(content).toContain('matcha');
      expect(content).toContain('Gatekeeping');
    });

    it('should return anecdotes section with memorable stories', () => {
      const content = getProfileSection('anecdotes');
      expect(content).toBeDefined();
      expect(content).toContain('Viral');
      expect(content).toContain('Oops');
      expect(content).toContain('Pageant');
      expect(content).toContain('Coffee Shop Meet-Cute');
      expect(content).toContain('Laptop Catastrophe');
    });

    it('should return routines section with daily schedule', () => {
      const content = getProfileSection('routines');
      expect(content).toBeDefined();
      expect(content).toContain('Morning');
      expect(content).toContain('Daytime');
      expect(content).toContain('Evening');
      expect(content).toContain('7:30');
      expect(content).toContain('Notion');
    });

    it('should return full profile when "full" section is requested', () => {
      const content = getProfileSection('full');
      expect(content).toBe(KAYLEY_FULL_PROFILE);
      expect(content.length).toBeGreaterThan(10000);
    });

    it('should fall back to full profile for unknown section', () => {
      const content = getProfileSection('unknown_section' as ProfileSection);
      expect(content).toBe(PROFILE_SECTIONS.full);
    });
  });

  describe('getAvailableSections', () => {
    it('should return all available section names', () => {
      const sections = getAvailableSections();
      expect(sections).toContain('background');
      expect(sections).toContain('interests');
      expect(sections).toContain('relationships');
      expect(sections).toContain('challenges');
      expect(sections).toContain('quirks');
      expect(sections).toContain('goals');
      expect(sections).toContain('preferences');
      expect(sections).toContain('anecdotes');
      expect(sections).toContain('routines');
      expect(sections).toContain('full');
      expect(sections.length).toBe(10);
    });
  });

  describe('PROFILE_SECTIONS', () => {
    it('should have all 10 sections defined', () => {
      const sections: ProfileSection[] = [
        'background',
        'interests',
        'relationships',
        'challenges',
        'quirks',
        'goals',
        'preferences',
        'anecdotes',
        'routines',
        'full',
      ];

      sections.forEach((section) => {
        expect(PROFILE_SECTIONS[section]).toBeDefined();
        expect(PROFILE_SECTIONS[section].length).toBeGreaterThan(100);
      });
    });

    it('should not have any empty sections', () => {
      Object.entries(PROFILE_SECTIONS).forEach(([key, value]) => {
        expect(value.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe('Condensed Profile', () => {
    it('should be significantly smaller than full profile', () => {
      const condensedLength = KAYLEY_CONDENSED_PROFILE.length;
      const fullLength = KAYLEY_FULL_PROFILE.length;

      // Condensed should be less than 25% of full profile
      expect(condensedLength).toBeLessThan(fullLength * 0.25);
    });

    it('should contain essential identity information', () => {
      expect(KAYLEY_CONDENSED_PROFILE).toContain('Kayley Adams');
      expect(KAYLEY_CONDENSED_PROFILE).toContain('28');
      expect(KAYLEY_CONDENSED_PROFILE).toContain('Austin');
      expect(KAYLEY_CONDENSED_PROFILE).toContain('AI/tech content creator');
    });

    it('should contain core personality traits', () => {
      expect(KAYLEY_CONDENSED_PROFILE).toContain('expressive');
      expect(KAYLEY_CONDENSED_PROFILE).toContain('empathetic');
      expect(KAYLEY_CONDENSED_PROFILE).toContain('Alexis Rose');
    });

    it('should contain communication style', () => {
      expect(KAYLEY_CONDENSED_PROFILE).toContain('Casual');
      expect(KAYLEY_CONDENSED_PROFILE).toContain('warm');
      expect(KAYLEY_CONDENSED_PROFILE).toContain('emojis');
    });

    it('should reference the tool for detailed information', () => {
      expect(KAYLEY_CONDENSED_PROFILE).toContain('recall_character_profile');
    });

    it('should NOT contain detailed backstory', () => {
      // These details should be in the tool, not condensed profile
      expect(KAYLEY_CONDENSED_PROFILE).not.toContain('PowerPoint decks as a kid');
      expect(KAYLEY_CONDENSED_PROFILE).not.toContain('Miss Congeniality');
      expect(KAYLEY_CONDENSED_PROFILE).not.toContain('Hollywood-adjacent PR firm');
    });
  });

  describe('Token Efficiency', () => {
    it('condensed profile should be under 6000 characters', () => {
      // ~6000 chars = ~1500 tokens
      expect(KAYLEY_CONDENSED_PROFILE.length).toBeLessThan(6000);
    });

    it('full profile should be over 15000 characters', () => {
      // Confirms the savings are significant
      expect(KAYLEY_FULL_PROFILE.length).toBeGreaterThan(15000);
    });

    it('each individual section should be reasonably sized', () => {
      const sections = getAvailableSections().filter((s) => s !== 'full');

      sections.forEach((section) => {
        const content = getProfileSection(section);
        // Each section should be under 8000 chars (~2000 tokens)
        expect(content.length).toBeLessThan(8000);
      });
    });
  });
});
