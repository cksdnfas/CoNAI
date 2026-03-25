import sharp from 'sharp';
import { AIMetadata } from '../types';
import { parseConaiWebPXmp, restoreRawDataFromConaiWebPXmp } from '../webpMetadata';
import { ExifTextExtractor } from './exifTextExtractor';

/**
 * WebP container metadata extractor.
 * Reads standard WebP container metadata such as CoNAI-managed XMP and EXIF text.
 */
export class WebPExtractor {
  /**
   * Extract parser-friendly raw metadata from WebP container metadata.
   */
  static async extract(filePath: string): Promise<AIMetadata> {
    try {
      const image = sharp(filePath);
      const metadata = await image.metadata();

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
      }

      if (metadata.exif) {
        const exifText = ExifTextExtractor.findLikelyAiMetadataText(metadata.exif);

        if (exifText) {
          if (exifText.includes('parameters') && exifText.includes('Steps:')) {
            return { parameters: exifText } as AIMetadata;
          }

          if (exifText.includes('Steps:') && exifText.includes('Sampler:')) {
            return { parameters: exifText } as AIMetadata;
          }

          if (exifText.includes('Negative prompt:')) {
            return { parameters: exifText } as AIMetadata;
          }

          if (exifText.trim().startsWith('{')) {
            return { Comment: exifText } as AIMetadata;
          }
        }
      }
    } catch (error) {
      console.warn('WebP metadata extraction error:', error);
    }

    return {};
  }
}
