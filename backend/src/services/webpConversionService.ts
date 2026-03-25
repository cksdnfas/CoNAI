import sharp from 'sharp';
import { MetadataExtractor } from './metadata';
import { buildConaiWebPXmp, createConaiWebPXmpPayload, ConaiWebPXmpPayload } from './metadata/webpMetadata';
import { toWindowsLongPathIfNeeded } from '../utils/pathResolver';

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

function clampQuality(quality: number | undefined): number {
  if (typeof quality !== 'number' || Number.isNaN(quality)) {
    return 90;
  }

  return Math.min(100, Math.max(1, Math.round(quality)));
}

export class WebPConversionService {
  private static async buildEmbeddedPayload(options: Pick<WebPConversionOptions, 'sourcePathForMetadata' | 'originalFileName' | 'mimeType'>): Promise<ConaiWebPXmpPayload | null> {
    if (!options.sourcePathForMetadata) {
      return null;
    }

    const extracted = await MetadataExtractor.extractPreservableData(options.sourcePathForMetadata);
    const rawData = extracted.rawData && Object.keys(extracted.rawData).length > 0
      ? extracted.rawData
      : undefined;
    const aiInfo = extracted.metadata.ai_info && Object.keys(extracted.metadata.ai_info).length > 0
      ? extracted.metadata.ai_info
      : undefined;

    if (!rawData && !aiInfo) {
      return null;
    }

    return createConaiWebPXmpPayload({
      sourcePath: options.sourcePathForMetadata,
      originalFileName: options.originalFileName,
      mimeType: options.mimeType,
      rawData,
      aiInfo,
      createdAt: extracted.metadata.extractedAt,
    });
  }

  static async convertFileToWebPBuffer(inputPath: string, options: WebPConversionOptions = {}): Promise<WebPConversionResult> {
    const embeddedPayload = await this.buildEmbeddedPayload({
      sourcePathForMetadata: options.sourcePathForMetadata || inputPath,
      originalFileName: options.originalFileName,
      mimeType: options.mimeType,
    });

    let pipeline = sharp(toWindowsLongPathIfNeeded(inputPath))
      .webp({
        quality: clampQuality(options.quality),
        lossless: options.lossless ?? false,
      });

    if (embeddedPayload) {
      pipeline = pipeline.withXmp(buildConaiWebPXmp(embeddedPayload));
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      info,
      embeddedPayload,
    };
  }

  static async convertBufferToWebPBuffer(inputBuffer: Buffer, options: WebPConversionOptions = {}): Promise<WebPConversionResult> {
    const embeddedPayload = await this.buildEmbeddedPayload({
      sourcePathForMetadata: options.sourcePathForMetadata,
      originalFileName: options.originalFileName,
      mimeType: options.mimeType,
    });

    let pipeline = sharp(inputBuffer)
      .webp({
        quality: clampQuality(options.quality),
        lossless: options.lossless ?? false,
      });

    if (embeddedPayload) {
      pipeline = pipeline.withXmp(buildConaiWebPXmp(embeddedPayload));
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      info,
      embeddedPayload,
    };
  }
}
