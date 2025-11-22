/**
 * JPEG Metadata Extractor
 * Extracts metadata from JPEG EXIF data
 */

import sharp from 'sharp';
import { AIMetadata } from '../types';

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
        // Sharp's exif data is in Buffer format - explicitly use utf8 for proper Unicode handling
        const exifString = metadata.exif.toString('utf8');

        if (exifString.includes('parameters') && exifString.includes('Steps:')) {
          // Will be parsed by WebUIParser
          return { parameters: exifString };
        }
      }
    } catch (error) {
      console.warn('JPEG metadata extraction error:', error);
    }

    return aiInfo;
  }
}
