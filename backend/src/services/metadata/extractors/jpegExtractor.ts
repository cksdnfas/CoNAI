/**
 * JPEG Metadata Extractor
 * Extracts metadata from JPEG EXIF data
 */

import sharp from 'sharp';
import { AIMetadata } from '../types';
import { ExifTextExtractor } from './exifTextExtractor';

export class JpegExtractor {
  /**
   * Extract metadata from JPEG file
   */
  static async extract(filePath: string): Promise<AIMetadata> {
    const aiInfo: AIMetadata = {};

    try {
      const image = sharp(filePath);
      const metadata = await image.metadata();

      // Extract AI metadata from EXIF Comment or UserComment
      if (metadata.exif) {
        const exifText = ExifTextExtractor.findLikelyAiMetadataText(metadata.exif);

        if (exifText) {
          if (exifText.includes('parameters') && exifText.includes('Steps:')) {
            return { parameters: exifText };
          }

          if (exifText.includes('Steps:') && exifText.includes('Sampler:')) {
            return { parameters: exifText };
          }

          if (exifText.includes('Negative prompt:')) {
            return { parameters: exifText };
          }

          if (exifText.trim().startsWith('{')) {
            return { Comment: exifText };
          }
        }
      }
    } catch (error) {
      console.warn('JPEG metadata extraction error:', error);
    }

    return aiInfo;
  }
}
