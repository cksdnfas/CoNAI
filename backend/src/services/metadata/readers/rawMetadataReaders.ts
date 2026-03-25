import { AIMetadata } from '../types';
import { PngExtractor } from '../extractors/pngExtractor';
import { JpegExtractor } from '../extractors/jpegExtractor';
import { WebPExtractor } from '../extractors/webpExtractor';
import { WebPStealthExtractor } from '../extractors/webpStealthExtractor';

interface RawMetadataReaderContext {
  buffer: Buffer;
  filePath: string;
  fileExt: string;
}

type RawMetadataReader = (context: RawMetadataReaderContext) => Promise<Record<string, any> | null>;

/**
 * Read PNG text-chunk based raw metadata.
 */
async function readPngRawMetadata(context: RawMetadataReaderContext): Promise<Record<string, any> | null> {
  if (context.fileExt !== '.png') {
    return null;
  }

  const rawData = PngExtractor.extract(context.buffer);
  return Object.keys(rawData).length > 0 ? rawData : null;
}

/**
 * Read JPEG EXIF-based raw metadata.
 */
async function readJpegRawMetadata(context: RawMetadataReaderContext): Promise<Record<string, any> | null> {
  if (!['.jpg', '.jpeg'].includes(context.fileExt)) {
    return null;
  }

  const rawData = await JpegExtractor.extract(context.filePath);
  return Object.keys(rawData).length > 0 ? rawData : null;
}

/**
 * Read standard WebP container metadata such as CoNAI XMP or EXIF text.
 */
async function readWebPContainerRawMetadata(context: RawMetadataReaderContext): Promise<Record<string, any> | null> {
  if (context.fileExt !== '.webp') {
    return null;
  }

  const rawData = await WebPExtractor.extract(context.filePath);
  return Object.keys(rawData).length > 0 ? rawData : null;
}

/**
 * Read WebP alpha-channel stealth metadata used by NovelAI-style exports.
 */
async function readWebPStealthRawMetadata(context: RawMetadataReaderContext): Promise<Record<string, any> | null> {
  if (context.fileExt !== '.webp') {
    return null;
  }

  const rawData = await WebPStealthExtractor.extract(context.buffer);
  return rawData && Object.keys(rawData).length > 0 ? rawData : null;
}

const RAW_METADATA_READERS: Record<string, RawMetadataReader[]> = {
  '.png': [readPngRawMetadata],
  '.jpg': [readJpegRawMetadata],
  '.jpeg': [readJpegRawMetadata],
  '.webp': [readWebPContainerRawMetadata, readWebPStealthRawMetadata],
};

/**
 * Run ordered raw metadata readers for a given file type.
 */
export async function readRawMetadata(context: RawMetadataReaderContext): Promise<AIMetadata> {
  const readers = RAW_METADATA_READERS[context.fileExt] ?? [];

  for (const reader of readers) {
    const rawData = await reader(context);
    if (rawData && Object.keys(rawData).length > 0) {
      return rawData as AIMetadata;
    }
  }

  return {};
}
