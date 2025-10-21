/**
 * PNG Metadata Extractor
 * Extracts metadata from PNG tEXt/zTXt chunks
 */

import { RawPngMetadata, AIMetadata } from '../types';

export class PngExtractor {
  /**
   * Extract metadata from PNG buffer
   */
  static extract(buffer: Buffer): AIMetadata {
    const aiInfo: AIMetadata = {};

    try {
      const { textChunks, rawStrings } = this.extractRawPngMetadata(buffer);

      // Check for NovelAI format
      if (textChunks['Software'] === 'NovelAI' || textChunks['Source']?.includes('NovelAI')) {
        console.log('✅ NovelAI image detected in PNG');

        // Will be parsed by NovelAIParser
        if (textChunks['Comment']) {
          return { Comment: textChunks['Comment'], Source: textChunks['Source'] };
        }
      }

      // Check for WebUI/SD format in raw strings
      for (const data of rawStrings) {
        if (data.includes('parameters') && data.includes('Steps:')) {
          // Will be parsed by WebUIParser
          return { parameters: data };
        }
      }

      // Return raw data for further processing
      return { textChunks, rawStrings };
    } catch (error) {
      console.warn('PNG metadata extraction error:', error);
      return {};
    }
  }

  /**
   * Extract raw PNG metadata from buffer
   * @returns textChunks (key-value pairs) and rawStrings (all text data)
   */
  private static extractRawPngMetadata(buffer: Buffer): RawPngMetadata {
    const textChunks: { [key: string]: string } = {};
    const rawStrings: string[] = [];

    try {
      // Verify PNG signature
      if (buffer.readUInt32BE(0) !== 0x89504E47) {
        return { textChunks, rawStrings };
      }

      let offset = 8; // Skip PNG signature

      while (offset < buffer.length - 8) {
        const chunkLength = buffer.readUInt32BE(offset);
        const chunkType = buffer.toString('ascii', offset + 4, offset + 8);

        // Process tEXt and zTXt chunks
        if (chunkType === 'tEXt' || chunkType === 'zTXt') {
          const chunkData = buffer.subarray(offset + 8, offset + 8 + chunkLength);
          const rawText = chunkData.toString('utf8');
          rawStrings.push(rawText);

          // Parse key-value structure (null-separated)
          const nullIndex = rawText.indexOf('\0');
          if (nullIndex > 0) {
            const key = rawText.substring(0, nullIndex);
            const value = rawText.substring(nullIndex + 1);
            textChunks[key] = value;
          }
        }

        offset += 8 + chunkLength + 4; // length + type + data + CRC
      }
    } catch (error) {
      console.error('PNG parsing error:', error);
    }

    return { textChunks, rawStrings };
  }
}
