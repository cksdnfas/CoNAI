import { AIMetadata } from '../types';
import { StandardMetadataExtractor } from './standardMetadataExtractor';

/**
 * WebP container metadata extractor.
 * Reads standard WebP container metadata such as XMP and EXIF.
 */
export class WebPExtractor {
  /**
   * Extract parser-friendly raw metadata from WebP container metadata.
   */
  static async extract(filePath: string): Promise<AIMetadata> {
    return StandardMetadataExtractor.extract(filePath);
  }
}
