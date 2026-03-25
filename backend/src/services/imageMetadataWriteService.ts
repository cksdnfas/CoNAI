import sharp from 'sharp';
import { MetadataExtractor } from './metadata';
import { buildConaiWebPXmp, buildPrimaryMetadataText, createConaiWebPXmpPayload, ConaiWebPXmpPayload } from './metadata/webpMetadata';
import { toWindowsLongPathIfNeeded } from '../utils/pathResolver';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

interface ImageMetadataWriteOptions {
  format: ImageOutputFormat;
  quality?: number;
  lossless?: boolean;
  sourcePathForMetadata?: string;
  originalFileName?: string;
  mimeType?: string;
}

interface ImageMetadataArtifacts {
  payload: ConaiWebPXmpPayload | null;
  xmp: string | null;
  exif: sharp.Exif | null;
}

export interface ImageMetadataWriteResult {
  buffer: Buffer;
  info: sharp.OutputInfo;
  embeddedPayload: ConaiWebPXmpPayload | null;
  xmpApplied: boolean;
  exifApplied: boolean;
}

function clampQuality(quality: number | undefined): number {
  if (typeof quality !== 'number' || Number.isNaN(quality)) {
    return 90;
  }

  return Math.min(100, Math.max(1, Math.round(quality)));
}

/** Build standard EXIF/XMP carriers from extracted source metadata. */
async function buildMetadataArtifacts(options: Pick<ImageMetadataWriteOptions, 'sourcePathForMetadata' | 'originalFileName' | 'mimeType'>): Promise<ImageMetadataArtifacts> {
  if (!options.sourcePathForMetadata) {
    return {
      payload: null,
      xmp: null,
      exif: null,
    };
  }

  const extracted = await MetadataExtractor.extractPreservableData(options.sourcePathForMetadata);
  const rawData = extracted.rawData && Object.keys(extracted.rawData).length > 0
    ? extracted.rawData
    : undefined;
  const aiInfo = extracted.metadata.ai_info && Object.keys(extracted.metadata.ai_info).length > 0
    ? extracted.metadata.ai_info
    : undefined;

  if (!rawData && !aiInfo) {
    return {
      payload: null,
      xmp: null,
      exif: null,
    };
  }

  const payload = createConaiWebPXmpPayload({
    sourcePath: options.sourcePathForMetadata,
    originalFileName: options.originalFileName,
    mimeType: options.mimeType,
    rawData,
    aiInfo,
    createdAt: extracted.metadata.extractedAt,
  });

  const primaryText = buildPrimaryMetadataText(rawData, aiInfo, payload.parserHint);
  const softwareValue = aiInfo?.ai_tool ? `CoNAI (${aiInfo.ai_tool})` : 'CoNAI';

  return {
    payload,
    xmp: buildConaiWebPXmp(payload),
    exif: {
      IFD0: {
        Software: softwareValue,
        ...(primaryText ? { ImageDescription: primaryText } : {}),
      },
      ...(primaryText ? {
        IFD2: {
          UserComment: primaryText,
        },
      } : {}),
    },
  };
}

/** Build a format-specific Sharp pipeline for metadata-aware image output. */
function buildFormatPipeline(input: string | Buffer, options: ImageMetadataWriteOptions): sharp.Sharp {
  const pipeline = typeof input === 'string'
    ? sharp(toWindowsLongPathIfNeeded(input))
    : sharp(input);

  if (options.format === 'png') {
    return pipeline.png();
  }

  if (options.format === 'jpeg') {
    return pipeline.jpeg({
      quality: clampQuality(options.quality),
    });
  }

  return pipeline.webp({
    quality: clampQuality(options.quality),
    lossless: options.lossless ?? false,
  });
}

/** Apply EXIF/XMP carriers onto an output pipeline when available. */
function applyMetadataArtifacts(pipeline: sharp.Sharp, artifacts: ImageMetadataArtifacts): sharp.Sharp {
  let nextPipeline = pipeline;

  if (artifacts.exif) {
    nextPipeline = nextPipeline.withExif(artifacts.exif);
  }

  if (artifacts.xmp) {
    nextPipeline = nextPipeline.withXmp(artifacts.xmp);
  }

  return nextPipeline;
}

export class ImageMetadataWriteService {
  static async writeFileAsFormatBuffer(inputPath: string, options: ImageMetadataWriteOptions): Promise<ImageMetadataWriteResult> {
    const artifacts = await buildMetadataArtifacts({
      sourcePathForMetadata: options.sourcePathForMetadata || inputPath,
      originalFileName: options.originalFileName,
      mimeType: options.mimeType,
    });

    const pipeline = applyMetadataArtifacts(buildFormatPipeline(inputPath, options), artifacts);
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      info,
      embeddedPayload: artifacts.payload,
      xmpApplied: Boolean(artifacts.xmp),
      exifApplied: Boolean(artifacts.exif),
    };
  }

  static async writeBufferAsFormatBuffer(inputBuffer: Buffer, options: ImageMetadataWriteOptions): Promise<ImageMetadataWriteResult> {
    const artifacts = await buildMetadataArtifacts({
      sourcePathForMetadata: options.sourcePathForMetadata,
      originalFileName: options.originalFileName,
      mimeType: options.mimeType,
    });

    const pipeline = applyMetadataArtifacts(buildFormatPipeline(inputBuffer, options), artifacts);
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      info,
      embeddedPayload: artifacts.payload,
      xmpApplied: Boolean(artifacts.xmp),
      exifApplied: Boolean(artifacts.exif),
    };
  }
}
