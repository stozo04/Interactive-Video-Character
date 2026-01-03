/**
 * Array utility functions for random selection and shuffling.
 *
 * @see src/utils/README.md for usage examples
 */

/**
 * Selects a random item from an array.
 *
 * @throws Error if the array is empty
 *
 * @example
 * randomFromArray(['a', 'b', 'c']) // Returns 'a', 'b', or 'c'
 */
export const randomFromArray = <T,>(items: T[]): T => {
  if (items.length === 0) {
    throw new Error('Cannot select a random item from an empty array.');
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
};

/**
 * Creates a shuffled copy of an array using Fisher-Yates algorithm.
 * Does not mutate the original array.
 *
 * @example
 * shuffleArray([1, 2, 3, 4, 5]) // Returns shuffled copy like [3, 1, 5, 2, 4]
 */
export const shuffleArray = <T,>(array: T[]): T[] => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};
