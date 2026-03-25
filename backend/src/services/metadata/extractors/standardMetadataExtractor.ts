import sharp from 'sharp';
import { AIMetadata } from '../types';
import { parseConaiWebPXmp, restoreRawDataFromConaiWebPXmp, extractLikelyAiMetadataTextFromXmp } from '../webpMetadata';
import { ExifTextExtractor } from './exifTextExtractor';

function looksLikeWebUiText(text: string): boolean {
  return (
    (text.includes('parameters') && text.includes('Steps:'))
    || (text.includes('Steps:') && text.includes('Sampler:'))
    || text.includes('Negative prompt:')
  );
}

function looksLikeComfyWorkflow(text: string): boolean {
  if (!text.trim().startsWith('{')) {
    return false;
  }

  try {
    const parsed = JSON.parse(text.replace(/NaN/g, 'null')) as Record<string, any>;
    return Object.values(parsed).some((value) => value && typeof value === 'object' && 'class_type' in value);
  } catch {
    return false;
  }
}

/** Convert a plain text metadata candidate into parser-friendly raw data. */
function buildRawDataFromText(text: string): AIMetadata {
  const normalized = text.trim();
  if (!normalized) {
    return {};
  }

  if (looksLikeWebUiText(normalized)) {
    return { parameters: normalized } as AIMetadata;
  }

  if (looksLikeComfyWorkflow(normalized)) {
    return { comfyui_workflow: normalized } as AIMetadata;
  }

  if (normalized.startsWith('{')) {
    return { Comment: normalized } as AIMetadata;
  }

  return {};
}

/** Read standard EXIF/XMP metadata carriers from any Sharp-supported image file. */
export class StandardMetadataExtractor {
  static async extract(filePath: string): Promise<AIMetadata> {
    try {
      const metadata = await sharp(filePath).metadata();

      if (metadata.xmp) {
        const xmpString = metadata.xmp.toString('utf8');
        const payload = parseConaiWebPXmp(xmpString);

        if (payload) {
          const restored = restoreRawDataFromConaiWebPXmp(payload);
          if (restored && Object.keys(restored).length > 0) {
            return restored as AIMetadata;
          }

          if (payload.aiInfo) {
            return payload.aiInfo;
          }
        }

        const xmpText = extractLikelyAiMetadataTextFromXmp(xmpString);
        if (xmpText) {
          const rawData = buildRawDataFromText(xmpText);
          if (Object.keys(rawData).length > 0) {
            return rawData;
          }
        }
      }

      if (metadata.exif) {
        const exifText = ExifTextExtractor.findLikelyAiMetadataText(metadata.exif);
        if (exifText) {
          const rawData = buildRawDataFromText(exifText);
          if (Object.keys(rawData).length > 0) {
            return rawData;
          }
        }
      }
    } catch (error) {
      console.warn('Standard metadata extraction error:', error);
    }

    return {};
  }
}
