/**
 * JPEG Metadata Extractor
 * Extracts metadata from standard JPEG metadata carriers.
 */

import { AIMetadata } from '../types';
import { StandardMetadataExtractor } from './standardMetadataExtractor';

export class JpegExtractor {
  /**
   * Extract metadata from JPEG file.
   */
  static async extract(filePath: string): Promise<AIMetadata> {
    return StandardMetadataExtractor.extract(filePath);
  }
}
