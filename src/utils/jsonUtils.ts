/**
 * JSON utility functions for parsing and extraction.
 *
 * @see src/utils/README.md for usage examples
 */

/**
 * Extracts a single JSON object from a string by finding matching braces.
 * Handles nested objects and strings containing braces correctly.
 *
 * @param str - String potentially containing a JSON object
 * @returns The extracted JSON string, or null if no valid object found
 *
 * @example
 * extractJsonObject('Some text {"key": "value"} more text')
 * // Returns: '{"key": "value"}'
 *
 * extractJsonObject('{"nested": {"inner": true}}')
 * // Returns: '{"nested": {"inner": true}}'
 */
export const extractJsonObject = (str: string): string | null => {
  const firstBrace = str.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = firstBrace; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') depth++;
      if (char === '}') depth--;

      if (depth === 0) {
        return str.substring(firstBrace, i + 1);
      }
    }
  }

  return null;
};
