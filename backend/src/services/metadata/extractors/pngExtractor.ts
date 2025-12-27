/**
 * PNG Metadata Extractor
 * Extracts metadata from PNG tEXt/zTXt chunks
 */

import zlib from 'zlib';
import { RawPngMetadata, AIMetadata } from '../types';
import { logger } from '../../../utils/logger';

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

      // PRIORITY 1: Check for WebUI/SD format in textChunks (actual prompt data)
      if (textChunks['parameters']) {
        logger.debug('✅ WebUI parameters found in textChunks (priority extraction)');

        // Also check for ComfyUI workflow as supplementary data
        let result: any = { parameters: textChunks['parameters'] };

        if (textChunks['prompt']) {
          const promptValue = textChunks['prompt'];
          if (promptValue.trim().startsWith('{')) {
            try {
              const sanitizedJSON = promptValue.replace(/NaN/g, 'null');
              const parsed = JSON.parse(sanitizedJSON);

              // Check for ComfyUI node structure
              for (const key in parsed) {
                const node = parsed[key];
                if (node && typeof node === 'object' && node.class_type) {
                  logger.debug('ℹ️ ComfyUI workflow also found (stored as supplementary data)');
                  result.comfyui_workflow = promptValue;
                  break;
                }
              }
            } catch (error) {
              // Ignore JSON parsing errors
            }
          }
        }

        return result;
      }

      // PRIORITY 2: Check for ComfyUI workflow in 'prompt' key (fallback when no parameters)
      if (textChunks['prompt']) {
        const promptValue = textChunks['prompt'];

        // Check if it's a workflow JSON
        if (promptValue.trim().startsWith('{')) {
          try {
            // Replace NaN with null for JSON parsing (ComfyUI sometimes uses NaN in arrays)
            const sanitizedJSON = promptValue.replace(/NaN/g, 'null');
            const parsed = JSON.parse(sanitizedJSON);

            // Check for ComfyUI node structure
            for (const key in parsed) {
              const node = parsed[key];
              if (node && typeof node === 'object' && node.class_type) {
                logger.debug('✅ ComfyUI workflow found in textChunks[prompt] (no parameters field)');
                return { comfyui_workflow: promptValue };
              }
            }
          } catch (error) {
            // Not valid JSON, continue
            console.log('⚠️ Failed to parse textChunks[prompt] as JSON:', (error as Error).message);
          }
        }
      }

      // Check for WebUI/SD format in raw strings (fallback)
      for (const data of rawStrings) {
        if (data.includes('parameters') && data.includes('Steps:')) {
          logger.debug('✅ WebUI parameters found in rawStrings');
          // Will be parsed by WebUIParser
          return { parameters: data };
        }
      }

      // Return raw data for further processing
      return { textChunks, rawStrings };
    } catch (error) {
      logger.warn('PNG metadata extraction error:', error);
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

        // Process tEXt chunks (uncompressed)
        if (chunkType === 'tEXt') {
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

        // Process zTXt chunks (compressed)
        if (chunkType === 'zTXt') {
          const chunkData = buffer.subarray(offset + 8, offset + 8 + chunkLength);

          // Find null byte separating keyword from compressed data
          const nullIndex = chunkData.indexOf(0);
          if (nullIndex > 0) {
            const key = chunkData.subarray(0, nullIndex).toString('utf8');
            // Skip compression method byte (always 0 for deflate)
            const compressedData = chunkData.subarray(nullIndex + 2);

            try {
              // Decompress zlib data
              const decompressed = zlib.inflateSync(compressedData);
              const value = decompressed.toString('utf8');
              textChunks[key] = value;
              rawStrings.push(`${key}\0${value}`);
            } catch (zlibError) {
              console.warn(`zTXt decompression failed for key "${key}":`, zlibError);
              // Fallback: store raw data
              const rawText = chunkData.toString('utf8');
              rawStrings.push(rawText);
            }
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
