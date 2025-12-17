import { describe, it, expect } from 'vitest';
import { GeminiMemoryToolDeclarations, OpenAIMemoryToolDeclarations } from '../aiSchema';

describe('aiSchema - Tool Declaration Parity', () => {
  /**
   * Extract tool names from each declaration format
   */
  const getGeminiToolNames = () => 
    GeminiMemoryToolDeclarations.map(tool => tool.name).sort();
  
  const getOpenAIToolNames = () => 
    OpenAIMemoryToolDeclarations.map(tool => tool.name).sort();

  describe('store_character_info tool', () => {
    it('should exist in GeminiMemoryToolDeclarations', () => {
      const toolNames = getGeminiToolNames();
      expect(toolNames).toContain('store_character_info');
    });

    it('should exist in OpenAIMemoryToolDeclarations', () => {
      const toolNames = getOpenAIToolNames();
      expect(toolNames).toContain('store_character_info');
    });
  });

  describe('tool declaration parity', () => {
    it('should have the same tool names in both Gemini and OpenAI declarations', () => {
      const geminiTools = getGeminiToolNames();
      const openAITools = getOpenAIToolNames();
      
      // Check that both arrays have the same tools
      expect(geminiTools).toEqual(openAITools);
    });

    it('should include all required memory tools', () => {
      const requiredTools = [
        'recall_memory',
        'recall_user_info', 
        'store_user_info',
        'task_action',
        'calendar_action',
        'store_character_info'
      ].sort();

      const geminiTools = getGeminiToolNames();
      const openAITools = getOpenAIToolNames();

      // Verify Gemini has all required tools
      for (const tool of requiredTools) {
        expect(geminiTools).toContain(tool);
      }

      // Verify OpenAI has all required tools
      for (const tool of requiredTools) {
        expect(openAITools).toContain(tool);
      }
    });
  });

  describe('store_character_info schema', () => {
    it('should have matching required parameters in both declarations', () => {
      const geminiTool = GeminiMemoryToolDeclarations.find(t => t.name === 'store_character_info');
      const openAITool = OpenAIMemoryToolDeclarations.find(t => t.name === 'store_character_info');

      expect(geminiTool).toBeDefined();
      expect(openAITool).toBeDefined();

      // Both should require category, key, value
      const geminiRequired = geminiTool?.parameters.required;
      const openAIRequired = openAITool?.parameters.required;

      expect(geminiRequired).toEqual(['category', 'key', 'value']);
      expect(openAIRequired).toEqual(['category', 'key', 'value']);
    });

    it('should have matching category enum values', () => {
      const geminiTool = GeminiMemoryToolDeclarations.find(t => t.name === 'store_character_info');
      const openAITool = OpenAIMemoryToolDeclarations.find(t => t.name === 'store_character_info');

      const geminiCategories = (geminiTool?.parameters.properties as any)?.category?.enum;
      const openAICategories = (openAITool?.parameters.properties as any)?.category?.enum;

      expect(geminiCategories).toBeDefined();
      expect(openAICategories).toBeDefined();
      expect(geminiCategories.sort()).toEqual(openAICategories.sort());
    });
  });
});

