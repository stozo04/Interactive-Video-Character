// src/utils/referenceImages/index.ts
// Auto-discovery system for reference images
// Config-driven: hairstyle + outfit specified in config.json (not derived from folder names)

import { ReferenceImageMetadata, HairstyleType, OutfitStyle } from '../../services/imageGeneration/types';
import configData from './config.json';

// Auto-import all images from subfolders
const imageModules = import.meta.glob<string>('./**/*.jpg', {
  query: '?base64',
  eager: true,
  import: 'default'
});

// Type for config entries (config.json specifies everything)
type ConfigEntry = {
  id: string;
  hairstyle: HairstyleType;
  outfit: OutfitStyle;
};

// Build the registry from discovered images + config
function buildRegistry(): ReferenceImageMetadata[] {
  const registry: ReferenceImageMetadata[] = [];
  const config = configData as Record<string, ConfigEntry>;

  for (const [importPath] of Object.entries(imageModules)) {
    // Convert import path "./curlyHairCasual/image.jpg" to config key "curlyHairCasual/image.jpg"
    const configKey = importPath.replace('./', '');
    const configEntry = config[configKey];

    if (!configEntry) {
      console.warn(`[ReferenceImages] No config found for: ${configKey}`);
      continue;
    }

    registry.push({
      id: configEntry.id,
      fileName: configKey,
      hairstyle: configEntry.hairstyle,
      outfitStyle: configEntry.outfit,
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
export function getAvailableHairstyles(): HairstyleType[] {
  return Array.from(new Set(REFERENCE_IMAGE_REGISTRY.map(r => r.hairstyle)));
}

/**
 * Get all available outfit styles
 */
export function getAvailableOutfits(): OutfitStyle[] {
  return Array.from(new Set(REFERENCE_IMAGE_REGISTRY.map(r => r.outfitStyle)));
}

// Log discovered images in development
if (import.meta.env.DEV) {
  console.log(`[ReferenceImages] Loaded ${REFERENCE_IMAGE_REGISTRY.length} reference images:`,
    REFERENCE_IMAGE_REGISTRY.map(r => `${r.id} (${r.hairstyle}/${r.outfitStyle})`));
}
