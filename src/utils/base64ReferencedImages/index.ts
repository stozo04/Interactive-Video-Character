// src/utils/base64ReferencedImages/index.ts

import { ReferenceImageMetadata } from '../../services/imageGeneration/types';

// Import all reference images
import curlyHairDressedUpRaw from './curly_hair_dressed_up.txt?raw';
import curlyHairCasualRaw from './curly_hair_casual.txt?raw';
import curlyHairMessyBunDressedUpRaw from './curly_hair_messy_bun_dressed_up.txt?raw';
import curlyHairMessyBunCasualRaw from './curly_hair_messy_bun_casual.txt?raw';
import straightHairDressedUpRaw from './straight_hair_dressed_up.txt?raw';
import straightHairCasualRaw from './straight_hair_casual.txt?raw';
import straightHairBunCasualRaw from './straight_hair_bun_casual.txt?raw';

// Reference image metadata registry
export const REFERENCE_IMAGE_REGISTRY: ReferenceImageMetadata[] = [
  {
    id: 'curly_casual',
    fileName: 'curly_hair_casual.txt',
    hairstyle: 'curly',
    outfitStyle: 'casual',
    baseFrequency: 0.4, // Most common look

    suitableScenes: ['coffee', 'cafe', 'home', 'park', 'city', 'library', 'office'],
    unsuitableScenes: ['gym', 'pool', 'concert'],
    suitableSeasons: ['fall', 'winter', 'spring', 'summer'],

    moodAffinity: {
      playful: 0.7,
      confident: 0.6,
      relaxed: 0.8,
      excited: 0.7,
      flirty: 0.6,
    },

    timeOfDay: {
      morning: 0.9,   // Great for morning coffee
      afternoon: 0.8,
      evening: 0.6,
      night: 0.5,
    },
  },

  {
    id: 'curly_dressed_up',
    fileName: 'curly_hair_dressed_up.txt',
    hairstyle: 'curly',
    outfitStyle: 'dressed_up',
    baseFrequency: 0.15, // Less common, special occasions

    suitableScenes: ['restaurant', 'concert', 'sunset', 'city'],
    unsuitableScenes: ['gym', 'home', 'bedroom', 'kitchen', 'pool'],
    suitableSeasons: ['fall', 'winter', 'spring', 'summer'],

    moodAffinity: {
      playful: 0.5,
      confident: 0.9,
      relaxed: 0.4,
      excited: 0.8,
      flirty: 0.9,
    },

    timeOfDay: {
      morning: 0.2,
      afternoon: 0.5,
      evening: 0.9,   // Evening events
      night: 0.9,
    },
  },

  {
    id: 'messy_bun_casual',
    fileName: 'curly_hair_messy_bun_casual.txt',
    hairstyle: 'messy_bun',
    outfitStyle: 'casual',
    baseFrequency: 0.2, // Common for active/lazy days

    suitableScenes: ['gym', 'home', 'bedroom', 'kitchen', 'office', 'park'],
    unsuitableScenes: ['restaurant', 'concert'],
    suitableSeasons: ['spring', 'summer', 'fall'],

    moodAffinity: {
      playful: 0.6,
      confident: 0.5,
      relaxed: 0.9,
      excited: 0.5,
      flirty: 0.4,
    },

    timeOfDay: {
      morning: 0.9,   // Just woke up vibe
      afternoon: 0.7,
      evening: 0.6,
      night: 0.7,     // Cozy night in
    },
  },

  {
    id: 'messy_bun_dressed_up',
    fileName: 'curly_hair_messy_bun_dressed_up.txt',
    hairstyle: 'messy_bun',
    outfitStyle: 'dressed_up',
    baseFrequency: 0.08, // Rare - practical hair for formal events

    suitableScenes: ['restaurant', 'concert', 'city', 'sunset'],
    unsuitableScenes: ['gym', 'bedroom', 'kitchen'],
    suitableSeasons: ['spring', 'summer', 'fall', 'winter'],

    moodAffinity: {
      playful: 0.6,
      confident: 0.7,
      relaxed: 0.5,
      excited: 0.7,
      flirty: 0.6,
    },

    timeOfDay: {
      morning: 0.3,
      afternoon: 0.6,
      evening: 0.8,   // Casual-chic evening look
      night: 0.8,
    },
  },

  {
    id: 'straight_casual',
    fileName: 'straight_hair_casual.txt',
    hairstyle: 'straight',
    outfitStyle: 'casual',
    baseFrequency: 0.12, // Occasional style change

    suitableScenes: ['coffee', 'cafe', 'home', 'park', 'city', 'office'],
    unsuitableScenes: ['gym', 'pool'],
    suitableSeasons: ['fall', 'winter', 'spring', 'summer'],

    moodAffinity: {
      playful: 0.6,
      confident: 0.7,
      relaxed: 0.7,
      excited: 0.6,
      flirty: 0.7,
    },

    timeOfDay: {
      morning: 0.7,
      afternoon: 0.8,
      evening: 0.7,
      night: 0.6,
    },
  },

  {
    id: 'straight_dressed_up',
    fileName: 'straight_hair_dressed_up.txt',
    hairstyle: 'straight',
    outfitStyle: 'dressed_up',
    baseFrequency: 0.1, // Special occasions, made an effort

    suitableScenes: ['restaurant', 'concert', 'sunset', 'city'],
    unsuitableScenes: ['gym', 'home', 'bedroom', 'kitchen', 'pool'],
    suitableSeasons: ['fall', 'winter', 'spring', 'summer'],

    moodAffinity: {
      playful: 0.4,
      confident: 0.95, // Very polished, confident look
      relaxed: 0.3,
      excited: 0.9,
      flirty: 0.95,
    },

    timeOfDay: {
      morning: 0.1,
      afternoon: 0.4,
      evening: 0.95,  // Date night energy
      night: 0.95,
    },
  },

  {
    id: 'straight_bun_casual',
    fileName: 'straight_hair_bun_casual.txt',
    hairstyle: 'messy_bun',
    outfitStyle: 'casual',
    baseFrequency: 0.05, // Alternative bun style

    suitableScenes: ['gym', 'home', 'office', 'park'],
    unsuitableScenes: ['restaurant', 'concert'],
    suitableSeasons: ['spring', 'summer', 'fall'],

    moodAffinity: {
      playful: 0.5,
      confident: 0.6,
      relaxed: 0.8,
      excited: 0.5,
      flirty: 0.4,
    },

    timeOfDay: {
      morning: 0.8,
      afternoon: 0.7,
      evening: 0.5,
      night: 0.6,
    },
  },
];

// Map file name to raw content
const REFERENCE_IMAGE_CONTENT: Record<string, string> = {
  'curly_hair_dressed_up.txt': curlyHairDressedUpRaw,
  'curly_hair_casual.txt': curlyHairCasualRaw,
  'curly_hair_messy_bun_dressed_up.txt': curlyHairMessyBunDressedUpRaw,
  'curly_hair_messy_bun_casual.txt': curlyHairMessyBunCasualRaw,
  'straight_hair_dressed_up.txt': straightHairDressedUpRaw,
  'straight_hair_casual.txt': straightHairCasualRaw,
  'straight_hair_bun_casual.txt': straightHairBunCasualRaw,
};

/**
 * Get reference image base64 content by ID
 */
export function getReferenceImageContent(referenceId: string): string | null {
  const metadata = REFERENCE_IMAGE_REGISTRY.find(r => r.id === referenceId);
  if (!metadata) return null;

  return REFERENCE_IMAGE_CONTENT[metadata.fileName] || null;
}

/**
 * Get reference image metadata by ID
 */
export function getReferenceMetadata(referenceId: string): ReferenceImageMetadata | null {
  return REFERENCE_IMAGE_REGISTRY.find(r => r.id === referenceId) || null;
}

/**
 * Get all available hairstyle types
 */
export function getAvailableHairstyles(): string[] {
  return Array.from(new Set(REFERENCE_IMAGE_REGISTRY.map(r => r.hairstyle)));
}
