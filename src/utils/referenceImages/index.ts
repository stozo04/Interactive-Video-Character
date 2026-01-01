// src/utils/referenceImages/index.ts
// Auto-discovery system for reference images
// To add new images: 1) Drop image in correct folder  2) Add entry to config.json

import { ReferenceImageMetadata, HairstyleType, OutfitStyle } from '../../services/imageGeneration/types';
import configData from './config.json';

// Auto-import all images from subfolders
const imageModules = import.meta.glob<string>('./**/*.jpg', {
  query: '?base64',
  eager: true,
  import: 'default'
});

// Folder name → hairstyle mapping
const FOLDER_TO_HAIRSTYLE: Record<string, string> = {
  'curlyHairCasual': 'curly',
  'curlyHairFormal': 'curly',
  'straightHairCasual': 'straight',
  'straightHairFormal': 'straight',
};

// Folder name → outfit style mapping
const FOLDER_TO_OUTFIT: Record<string, string> = {
  'curlyHairCasual': 'casual',
  'curlyHairFormal': 'dressed_up',
  'straightHairCasual': 'casual',
  'straightHairFormal': 'dressed_up',
};

// Type for config entries
type ConfigEntry = {
  id: string;
  baseFrequency: number;
  suitableScenes: string[];
  unsuitableScenes: string[];
  suitableSeasons: string[];
  moodAffinity: Record<string, number>;
  timeOfDay: Record<string, number>;
};

// Build the registry from discovered images + config
function buildRegistry(): ReferenceImageMetadata[] {
  const registry: ReferenceImageMetadata[] = [];
  const config = configData as Record<string, ConfigEntry>;

  for (const [importPath, base64Content] of Object.entries(imageModules)) {
    // Convert import path "./curlyHairCasual/image.jpg" to config key "curlyHairCasual/image.jpg"
    const configKey = importPath.replace('./', '');
    const configEntry = config[configKey];

    if (!configEntry) {
      console.warn(`[ReferenceImages] No config found for: ${configKey}`);
      continue;
    }

    // Extract folder name for defaults
    const folderName = configKey.split('/')[0];
    const fileName = configKey.split('/').pop() || '';

    // Detect hairstyle override from filename (e.g., "messy_bun" in filename)
    let hairstyle = FOLDER_TO_HAIRSTYLE[folderName] || 'curly';
    if (fileName.includes('messy_bun') || fileName.includes('bun')) {
      hairstyle = 'messy_bun';
    }

    registry.push({
      id: configEntry.id,
      fileName: configKey,
      hairstyle: hairstyle as HairstyleType,
      outfitStyle: (FOLDER_TO_OUTFIT[folderName] || 'casual') as OutfitStyle,
      baseFrequency: configEntry.baseFrequency,
      suitableScenes: configEntry.suitableScenes,
      unsuitableScenes: configEntry.unsuitableScenes,
      suitableSeasons: configEntry.suitableSeasons as Array<'spring' | 'summer' | 'fall' | 'winter'>,
      moodAffinity: configEntry.moodAffinity as Record<'playful' | 'confident' | 'relaxed' | 'excited' | 'flirty', number>,
      timeOfDay: configEntry.timeOfDay as Record<'morning' | 'afternoon' | 'evening' | 'night', number>,
    });
  }

  return registry;
}

// Build image content map from discovered images
function buildContentMap(): Record<string, string> {
  const contentMap: Record<string, string> = {};

  for (const [importPath, base64Content] of Object.entries(imageModules)) {
    const configKey = importPath.replace('./', '');
    contentMap[configKey] = base64Content;
  }

  return contentMap;
}

// Export the registry (built once at module load)
export const REFERENCE_IMAGE_REGISTRY: ReferenceImageMetadata[] = buildRegistry();

// Internal content map
const REFERENCE_IMAGE_CONTENT: Record<string, string> = buildContentMap();

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

// Log discovered images in development
if (import.meta.env.DEV) {
  console.log(`[ReferenceImages] Loaded ${REFERENCE_IMAGE_REGISTRY.length} reference images:`,
    REFERENCE_IMAGE_REGISTRY.map(r => r.id));
}
