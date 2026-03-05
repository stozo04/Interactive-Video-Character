// src/utils/referenceImages/index.ts
// Auto-discovery system for reference images
// Config-driven: hairstyle + outfit specified in config.json (not derived from folder names)

import { ReferenceImageMetadata, HairstyleType, OutfitStyle } from '../../services/imageGeneration/types';
import configData from './config.json';
import { clientLogger } from '../../services/clientLogger';

const log = clientLogger.scoped('ReferenceImages');

// Auto-import all images from subfolders
const imageModules = import.meta.glob<string>('./**/*.jpg', {
  query: '?base64',
  eager: true,
  import: 'default'
});

// Type for individual image entries (optional overrides)
type ImageEntry = {
  id: string;
  url: string; // For Grok
  fileName: string;
  hairstyle?: HairstyleType;  // Optional override
  outfit?: OutfitStyle;       // Optional override
};

// Type for folder config (defaults + images array)
type FolderConfig = {
  hairstyle: HairstyleType;   // Folder default
  outfit: OutfitStyle;        // Folder default
  images: ImageEntry[];
};

// Config structure: folder -> { defaults, images[] }
type ConfigData = Record<string, FolderConfig>;

function buildRegistryFromConfig(): ReferenceImageMetadata[] {
  const registry: ReferenceImageMetadata[] = [];
  const config = configData as ConfigData;
  for (const [folder, folderConfig] of Object.entries(config)) {
    for (const imageEntry of folderConfig.images || []) {
      registry.push({
        id: imageEntry.id,
        url: imageEntry.url,
        fileName: `${folder}/${imageEntry.fileName}`,
        hairstyle: imageEntry.hairstyle || folderConfig.hairstyle,
        outfitStyle: imageEntry.outfit || folderConfig.outfit,
      });
    }
  }
  return registry;
}

// Build the registry from discovered images + config
function buildRegistry(): ReferenceImageMetadata[] {
  const registry: ReferenceImageMetadata[] = [];
  const config = configData as ConfigData;
  // console.log("[ReferenceImages] Building registry from modules:", Object.keys(imageModules));

  for (const [importPath] of Object.entries(imageModules)) {
    // Convert import path "./curlyHairCasual/image.jpg" to folder "curlyHairCasual" and file "image.jpg"
    const pathWithoutPrefix = importPath.replace('./', '');
    const [folder, fileName] = pathWithoutPrefix.split('/');

    // Find the folder config
    const folderConfig = config[folder];
    if (!folderConfig) {
      log.warning(`No config folder found for: ${folder}`);
      continue;
    }

    // Find the image entry in the folder's images array
    const imageEntry = folderConfig.images.find(img => img.fileName === fileName);
    if (!imageEntry) {
      log.warning(`No config entry found for: ${pathWithoutPrefix}`);
      continue;
    }

    // Use image override if present, otherwise use folder default
    registry.push({
      id: imageEntry.id,
      url: imageEntry.url,
      fileName: pathWithoutPrefix,
      hairstyle: imageEntry.hairstyle || folderConfig.hairstyle,
      outfitStyle: imageEntry.outfit || folderConfig.outfit,
    });
  }

  if (registry.length === 0) {
    log.warning('No Vite image modules found; falling back to config registry.');
    return buildRegistryFromConfig();
  }

  return registry;
}

// Build image content map from discovered images
function buildContentMapForGemini(): Record<string, string> {
  const contentMap: Record<string, string> = {};

  for (const [importPath, base64Content] of Object.entries(imageModules)) {
    const configKey = importPath.replace('./', '');
    contentMap[configKey] = base64Content;
  }

  if (Object.keys(contentMap).length === 0) {
    log.warning('No Gemini base64 content available in this runtime.');
  }
  return contentMap;
}

function buildContentMapForGrok(): Record<string, string> {
  const contentMap: Record<string, string> = {};

  if (Object.keys(imageModules).length > 0) {
    for (const [importPath, url] of Object.entries(imageModules)) {
      const configKey = importPath.replace('./', '');
      contentMap[configKey] = url;
    }
  } else {
    for (const [folder, folderConfig] of Object.entries(configData as ConfigData)) {
      for (const imageEntry of folderConfig.images || []) {
        const configKey = `${folder}/${imageEntry.fileName}`;
        contentMap[configKey] = imageEntry.url;
      }
    }
  }

  return contentMap;
}

// Export the registry (built once at module load)
export const REFERENCE_IMAGE_REGISTRY: ReferenceImageMetadata[] = buildRegistry();

// Internal content map
const REFERENCE_IMAGE_CONTENT_GEMINI: Record<string, string> = buildContentMapForGemini();

const REFERENCE_IMAGE_CONTENT_GROK: Record<string, string> = buildContentMapForGrok();

/**
 * Get reference image base64 content by ID
 */
export function getReferenceImageContentForGemini(referenceId: string): string | null {
  const metadata = REFERENCE_IMAGE_REGISTRY.find(r => r.id === referenceId);
  if (!metadata) return null;

  return REFERENCE_IMAGE_CONTENT_GEMINI[metadata.fileName] || null;
}

export function getReferenceImageContentForGrok(referenceId: string): string | null {
  const metadata = REFERENCE_IMAGE_REGISTRY.find(r => r.id === referenceId);
  if (!metadata) return null;

  return REFERENCE_IMAGE_CONTENT_GROK[metadata.fileName] || null;
}

/**
 * Server-compatible: fetch reference image as base64 from Supabase public URL.
 * Used when import.meta.glob (Vite/browser) is unavailable.
 */
export async function fetchReferenceImageContentForGemini(referenceId: string): Promise<string | null> {
  const metadata = REFERENCE_IMAGE_REGISTRY.find(r => r.id === referenceId);
  if (!metadata?.url) return null;
  try {
    const response = await fetch(metadata.url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch (err) {
    log.error('Failed to fetch Gemini reference from URL', { referenceId, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Server-compatible: return the Supabase public URL for a reference image.
 * Grok takes URLs directly, so no HTTP fetch needed.
 */
export async function fetchReferenceImageContentForGrok(referenceId: string): Promise<string | null> {
  const metadata = REFERENCE_IMAGE_REGISTRY.find(r => r.id === referenceId);
  return metadata?.url || null;
}

/**
 * Get reference image metadata by ID
 */
export function getReferenceMetadata(referenceId: string): ReferenceImageMetadata | null {
  return REFERENCE_IMAGE_REGISTRY.find(r => r.id === referenceId) || null;
}

function getAllConfigImages(): ImageEntry[] {
  const config = configData as ConfigData;
  const entries: ImageEntry[] = [];
  for (const folderConfig of Object.values(config)) {
    entries.push(...(folderConfig.images || []));
  }
  return entries;
}

/**
 * Get a random reference image URL for Grok.
 * Falls back to config.json if the registry is empty.
 */
export function getRandomReferenceImageForGrok(): {
  referenceId: string;
  url: string;
} {
  if (REFERENCE_IMAGE_REGISTRY.length > 0) {
    const index = Math.floor(Math.random() * REFERENCE_IMAGE_REGISTRY.length);
    const item = REFERENCE_IMAGE_REGISTRY[index];
    return { referenceId: item.id, url: item.url };
  }

  const configImages = getAllConfigImages();
  if (configImages.length === 0) {
    throw new Error("[ReferenceImages] No reference images available for Grok");
  }

  const index = Math.floor(Math.random() * configImages.length);
  const item = configImages[index];
  return { referenceId: item.id, url: item.url };
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
// if (import.meta.env.DEV) {
//     console.log(`[ReferenceImages] Loaded ${REFERENCE_IMAGE_REGISTRY.length} reference images:`,
//     REFERENCE_IMAGE_REGISTRY.map(r => `${r.id} (${r.hairstyle}/${r.outfitStyle})`));
//}
