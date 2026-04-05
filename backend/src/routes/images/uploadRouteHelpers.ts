import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import { ImageProcessor } from '../../services/imageProcessor';
import { AIMetadata } from '../../services/metadata';
import { ImageMetadataWriteService, ImageOutputFormat } from '../../services/imageMetadataWriteService';

/** Shared multipart image-save options accepted by upload-related routes. */
export type UploadImageSaveRequestOptions = {
  format?: 'original' | ImageOutputFormat;
  quality?: number;
  resizeEnabled?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  enabled?: boolean;
};

/** Check whether one mime type is a video upload. */
export function isVideoFile(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/** Check whether one mime type is an image upload. */
export function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** Skip image-save rewriting for animated or video-like uploads. */
export function isAnimatedUploadBypass(file: Express.Multer.File): boolean {
  const mimeType = (file.mimetype || '').toLowerCase();
  const lowerName = (file.originalname || '').toLowerCase();
  return mimeType.startsWith('video/') || mimeType === 'image/gif' || lowerName.endsWith('.gif') || lowerName.endsWith('.apng');
}

/** Parse a multipart boolean field with a fallback value. */
export function parseMultipartBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return fallback;
}

/** Parse a multipart integer field with rounding and fallback behavior. */
export function parseMultipartInteger(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }

  return fallback;
}

/** Parse upload image-save options from multipart form data. */
export function parseUploadImageSaveOptions(body: Request['body']): UploadImageSaveRequestOptions {
  const rawFormat = typeof body.format === 'string' ? body.format.trim().toLowerCase() : undefined;
  const format = rawFormat === 'original' || rawFormat === 'png' || rawFormat === 'jpeg' || rawFormat === 'jpg' || rawFormat === 'webp'
    ? (rawFormat === 'jpg' ? 'jpeg' : rawFormat) as UploadImageSaveRequestOptions['format']
    : undefined;

  return {
    enabled: parseMultipartBoolean(body.enabled, false),
    format,
    quality: parseMultipartInteger(body.quality, 85),
    resizeEnabled: parseMultipartBoolean(body.resizeEnabled, false),
    maxWidth: parseMultipartInteger(body.maxWidth, 1536),
    maxHeight: parseMultipartInteger(body.maxHeight, 1536),
  };
}

/** Resolve the output format used for upload-side image rewriting. */
export function resolveUploadOutputFormat(file: Express.Multer.File, requestedFormat?: 'original' | ImageOutputFormat): ImageOutputFormat | null {
  if (requestedFormat && requestedFormat !== 'original') {
    return requestedFormat;
  }

  const mimeType = (file.mimetype || '').toLowerCase();
  const extension = path.extname(file.originalname).toLowerCase();
  if (mimeType === 'image/png' || extension === '.png') {
    return 'png';
  }
  if (mimeType === 'image/jpeg' || extension === '.jpg' || extension === '.jpeg') {
    return 'jpeg';
  }
  if (mimeType === 'image/webp' || extension === '.webp') {
    return 'webp';
  }

  return null;
}

/** Process one uploaded image while honoring optional save/rewrite settings. */
export async function processImageUploadWithSettings(
  file: Express.Multer.File,
  baseUploadPath: string,
  options: UploadImageSaveRequestOptions,
) {
  if (!options.enabled || isAnimatedUploadBypass(file)) {
    return ImageProcessor.processImage(file, baseUploadPath);
  }

  const targetFormat = resolveUploadOutputFormat(file, options.format);
  if (!targetFormat) {
    return ImageProcessor.processImage(file, baseUploadPath);
  }

  const folders = await ImageProcessor.createUploadFolders(baseUploadPath);
  const requestedExtension = targetFormat === 'jpeg' ? 'jpg' : targetFormat;
  const originalBaseName = path.basename(file.originalname, path.extname(file.originalname));
  const filename = ImageProcessor.generateUniqueFilename(`${originalBaseName}.${requestedExtension}`);
  const outputPath = path.join(folders.targetFolder, filename);

  try {
    const rewritten = await ImageMetadataWriteService.writeFileAsFormatBuffer(file.path, {
      format: targetFormat,
      quality: options.quality,
      sourcePathForMetadata: file.path,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      maxWidth: options.resizeEnabled ? options.maxWidth : undefined,
      maxHeight: options.resizeEnabled ? options.maxHeight : undefined,
    });

    await fs.promises.writeFile(outputPath, rewritten.buffer);

    return {
      filename,
      originalPath: path.relative(baseUploadPath, outputPath).replace(/\\/g, '/'),
      thumbnailPath: '',
      width: rewritten.info.width || 0,
      height: rewritten.info.height || 0,
      fileSize: rewritten.buffer.length,
      metadata: { ai_info: {} } as any,
      perceptualHash: undefined,
      colorHistogram: undefined,
      mimeType: buildOutputMimeType(targetFormat),
    };
  } finally {
    await cleanupTemporaryUpload(file);
  }
}

/** Parse a best-effort JSON payload from multipart form data. */
export function parseMaybeJson(value: unknown) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Build a safe download filename for one converted image output. */
export function buildDownloadFileName(originalName: string, format: ImageOutputFormat = 'webp'): string {
  const baseName = path.basename(originalName, path.extname(originalName)) || 'converted-image';
  const safeBaseName = baseName.replace(/[\\/:*?"<>|]/g, '_');
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `${safeBaseName}.${extension}`;
}

/** Parse a requested output format into a supported image format. */
export function resolveOutputFormat(requestedFormat: unknown, file: Express.Multer.File): ImageOutputFormat {
  if (typeof requestedFormat === 'string') {
    const normalized = requestedFormat.trim().toLowerCase();
    if (normalized === 'png' || normalized === 'webp') {
      return normalized;
    }

    if (normalized === 'jpg' || normalized === 'jpeg') {
      return 'jpeg';
    }
  }

  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === '.png') {
    return 'png';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'jpeg';
  }

  if (extension === '.webp') {
    return 'webp';
  }

  return 'webp';
}

/** Build a response content-type for one converted image format. */
export function buildOutputMimeType(format: ImageOutputFormat): string {
  if (format === 'png') {
    return 'image/png';
  }

  if (format === 'jpeg') {
    return 'image/jpeg';
  }

  return 'image/webp';
}

/** Parse a JSON metadata patch payload from multipart form data. */
export function parseMetadataPatch(value: unknown): Partial<AIMetadata> | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'string'
    ? parseMaybeJson(value)
    : value;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('metadataPatch must be a JSON object');
  }

  return parsed as Partial<AIMetadata>;
}

/** Build the lightweight extracted-image preview response for metadata-only routes. */
export function buildExtractedImagePreview(
  file: Express.Multer.File,
  metadata: Awaited<ReturnType<typeof ImageProcessor.extractMetadata>>,
  imageInfo: Awaited<ReturnType<typeof ImageProcessor.getImageInfo>>,
) {
  const aiInfo = (metadata.ai_info || {}) as Record<string, any>;

  return {
    id: `extract:${file.filename || file.originalname}`,
    width: imageInfo.width || aiInfo.width || null,
    height: imageInfo.height || aiInfo.height || null,
    file_size: file.size,
    mime_type: file.mimetype,
    ai_metadata: {
      ai_tool: aiInfo.ai_tool || null,
      model_name: aiInfo.model || null,
      lora_models: Array.isArray(aiInfo.lora_models) ? aiInfo.lora_models : null,
      generation_params: {
        steps: aiInfo.steps ?? null,
        cfg_scale: aiInfo.cfg_scale ?? aiInfo.scale ?? null,
        sampler: aiInfo.sampler ?? null,
        seed: aiInfo.seed ?? null,
        scheduler: aiInfo.scheduler ?? null,
      },
      prompts: {
        prompt: aiInfo.prompt || aiInfo.positive_prompt || null,
        negative_prompt: aiInfo.negative_prompt || null,
        character_prompt_text: aiInfo.character_prompt_text || null,
      },
      raw_nai_parameters: parseMaybeJson(aiInfo.raw_nai_parameters),
    },
  };
}

/** Resolve the single uploaded file from either image/file multipart fields. */
export function getSingleUploadedFile(req: Request) {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  return files?.['image']?.[0] || files?.['file']?.[0] || null;
}

/** Best-effort cleanup for one temporary uploaded file. */
export async function cleanupTemporaryUpload(file: Express.Multer.File | null) {
  if (!file?.path || !fs.existsSync(file.path)) {
    return;
  }

  try {
    await fs.promises.unlink(file.path);
  } catch (cleanupError) {
    console.warn('Failed to cleanup temp extraction file:', file.path, cleanupError);
  }
}
