/**
 * Text utility functions for sanitization and analysis.
 *
 * @see src/utils/README.md for usage examples
 */

/**
 * Sanitizes text for comparison by lowercasing, removing special characters,
 * and normalizing whitespace.
 */
export const sanitizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Common question starter words for detecting interrogative sentences.
 */
export const QUESTION_STARTERS = [
  'who', 'what', 'when', 'where', 'why', 'how',
  'do', 'does', 'did', 'can', 'could', 'would', 'will', 'is', 'are', 'am', 'was', 'were',
  'should', 'shall', 'have', 'has', 'had'
];

/**
 * Determines if a message is a question based on:
 * 1. Ending with a question mark
 * 2. Starting with a common question word
 */
export const isQuestionMessage = (message: string): boolean => {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('?')) return true;
  const normalized = sanitizeText(trimmed);
  if (!normalized) return false;
  const firstWord = normalized.split(' ')[0];
  return QUESTION_STARTERS.includes(firstWord);
};
