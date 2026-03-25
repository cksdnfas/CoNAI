import sharp from 'sharp';
import { ConaiWebPXmpPayload } from './metadata/webpMetadata';
import { ImageMetadataWriteService } from './imageMetadataWriteService';

interface WebPConversionOptions {
  quality?: number;
  lossless?: boolean;
  sourcePathForMetadata?: string;
  originalFileName?: string;
  mimeType?: string;
}

interface WebPConversionResult {
  buffer: Buffer;
  info: sharp.OutputInfo;
  embeddedPayload: ConaiWebPXmpPayload | null;
}

export class WebPConversionService {
  static async convertFileToWebPBuffer(inputPath: string, options: WebPConversionOptions = {}): Promise<WebPConversionResult> {
    const result = await ImageMetadataWriteService.writeFileAsFormatBuffer(inputPath, {
      format: 'webp',
      quality: options.quality,
      lossless: options.lossless,
      sourcePathForMetadata: options.sourcePathForMetadata || inputPath,
      originalFileName: options.originalFileName,
      mimeType: options.mimeType,
    });

    return {
      buffer: result.buffer,
      info: result.info,
      embeddedPayload: result.embeddedPayload,
    };
  }

  static async convertBufferToWebPBuffer(inputBuffer: Buffer, options: WebPConversionOptions = {}): Promise<WebPConversionResult> {
    const result = await ImageMetadataWriteService.writeBufferAsFormatBuffer(inputBuffer, {
      format: 'webp',
      quality: options.quality,
      lossless: options.lossless,
      sourcePathForMetadata: options.sourcePathForMetadata,
      originalFileName: options.originalFileName,
      mimeType: options.mimeType,
    });

    return {
      buffer: result.buffer,
      info: result.info,
      embeddedPayload: result.embeddedPayload,
    };
  }
}
