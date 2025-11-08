import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { TempImageService, EditOptions } from './tempImageService';
import { runtimePaths } from '../config/runtimePaths';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../models/Image/ImageFileModel';
import { ImageUploadService } from './imageUploadService';
import { db } from '../database/init';

export interface EditResult {
  tempId: string;
  tempImagePath: string;
  tempMaskPath?: string;
  expiresAt: Date;
  width: number;
  height: number;
}

/**
 * Image editing service using Sharp
 * - All edits create temporary files
 * - Original images are never modified
 * - Supports crop, resize, and mask operations
 */
export class ImageEditorService {
  /**
   * Apply edits to an image and create temporary file
   */
  static async editImage(
    imageId: number,
    editOptions: EditOptions,
    expirationMinutes: number = 30
  ): Promise<EditResult> {
    // Get original image info from legacy images table
    const row = db.prepare('SELECT file_path FROM images WHERE id = ?').get(imageId) as { file_path: string } | undefined;
    if (!row) {
      throw new Error(`Image not found: ${imageId}`);
    }

    const originalPath = path.join(runtimePaths.uploadsDir, row.file_path);

    if (!fs.existsSync(originalPath)) {
      throw new Error(`Image file not found: ${row.file_path}`);
    }

    // Create temp ID and paths
    const tempId = TempImageService.createTempId();
    const tempImagePath = TempImageService.getTempFilePath(tempId, 'image');

    // Start with original image
    let imageProcessor = sharp(originalPath);

    // Apply crop if specified
    if (editOptions.crop) {
      const { x, y, width, height } = editOptions.crop;
      imageProcessor = imageProcessor.extract({
        left: Math.max(0, Math.floor(x)),
        top: Math.max(0, Math.floor(y)),
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height))
      });
    }

    // Apply resize if specified
    if (editOptions.resize) {
      const { width, height } = editOptions.resize;
      imageProcessor = imageProcessor.resize(width, height, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3
      });
    }

    // Save edited image
    await imageProcessor.png().toFile(tempImagePath);

    // Get final dimensions
    const metadata = await sharp(tempImagePath).metadata();
    const finalWidth = metadata.width || 0;
    const finalHeight = metadata.height || 0;

    // Handle mask if specified
    let tempMaskPath: string | undefined;
    if (editOptions.mask?.data) {
      tempMaskPath = TempImageService.getTempFilePath(tempId, 'mask');

      // Save mask as grayscale PNG
      await sharp(editOptions.mask.data)
        .greyscale()
        .png()
        .toFile(tempMaskPath);
    }

    // Register temporary files
    const tempInfo = TempImageService.registerTempFile(
      tempId,
      imageId,
      tempImagePath,
      tempMaskPath,
      expirationMinutes
    );

    return {
      tempId,
      tempImagePath,
      tempMaskPath,
      expiresAt: tempInfo.expiresAt,
      width: finalWidth,
      height: finalHeight
    };
  }

  /**
   * Save edited image as a new permanent image
   */
  static async saveEditedImageAsNew(
    imageId: number,
    editOptions: EditOptions,
    customName?: string
  ): Promise<number> {
    // Get original image from legacy images table
    const originalImage = db.prepare(`
      SELECT filename, file_path, ai_tool, model_name, lora_models, steps, cfg_scale, sampler,
             seed, scheduler, prompt, negative_prompt, denoise_strength, generation_time,
             batch_size, batch_index, auto_tags
      FROM images
      WHERE id = ?
    `).get(imageId) as any;

    if (!originalImage) {
      throw new Error(`Image not found: ${imageId}`);
    }

    const originalPath = path.join(runtimePaths.uploadsDir, originalImage.file_path);

    if (!fs.existsSync(originalPath)) {
      throw new Error(`Image file not found: ${originalImage.file_path}`);
    }

    // Create date-based folder
    const { ImageProcessor } = await import('./imageProcessor');
    const folders = await ImageProcessor.createUploadFolders(runtimePaths.uploadsDir);

    // Generate filename
    const baseName = customName || path.parse(originalImage.filename).name + '_edited';
    const filename = `${baseName}_${Date.now()}.png`;
    const newImagePath = path.join(folders.targetFolder, filename);

    // Apply edits
    let imageProcessor = sharp(originalPath);

    if (editOptions.crop) {
      const { x, y, width, height } = editOptions.crop;
      imageProcessor = imageProcessor.extract({
        left: Math.max(0, Math.floor(x)),
        top: Math.max(0, Math.floor(y)),
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height))
      });
    }

    if (editOptions.resize) {
      const { width, height } = editOptions.resize;
      imageProcessor = imageProcessor.resize(width, height, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3
      });
    }

    // Save new image
    await imageProcessor.png().toFile(newImagePath);

    // Get image info
    const metadata = await sharp(newImagePath).metadata();
    const stats = await fs.promises.stat(newImagePath);

    // Create thumbnail
    const thumbnailFilename = `${path.parse(filename).name}_thumb.webp`;
    const thumbnailPath = path.join(folders.targetFolder, thumbnailFilename);
    await ImageProcessor.generateThumbnail(newImagePath, thumbnailPath);

    // Create relative paths
    const relativeImagePath = path.join(folders.dateFolder, filename).replace(/\\/g, '/');
    const relativeThumbnailPath = path.join(folders.dateFolder, thumbnailFilename).replace(/\\/g, '/');

    // Save to legacy database
    const result = db.prepare(`
      INSERT INTO images (
        filename, original_name, file_path, thumbnail_path, file_size, mime_type,
        width, height, metadata, ai_tool, model_name, lora_models, steps, cfg_scale,
        sampler, seed, scheduler, prompt, negative_prompt, denoise_strength,
        generation_time, batch_size, batch_index, auto_tags,
        duration, fps, video_codec, audio_codec, bitrate,
        perceptual_hash, color_histogram
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      filename,
      customName || `${originalImage.filename} (edited)`,
      relativeImagePath,
      relativeThumbnailPath,
      stats.size,
      'image/png',
      metadata.width || 0,
      metadata.height || 0,
      JSON.stringify({
        ai_info: {},
        edited_from: imageId,
        edit_options: editOptions
      }),
      originalImage.ai_tool,
      originalImage.model_name,
      originalImage.lora_models,
      originalImage.steps,
      originalImage.cfg_scale,
      originalImage.sampler,
      originalImage.seed,
      originalImage.scheduler,
      originalImage.prompt,
      originalImage.negative_prompt,
      originalImage.denoise_strength,
      originalImage.generation_time,
      originalImage.batch_size,
      originalImage.batch_index,
      originalImage.auto_tags,
      null, // duration
      null, // fps
      null, // video_codec
      null, // audio_codec
      null, // bitrate
      null, // perceptual_hash
      null  // color_histogram
    );

    const newImageId = Number(result.lastInsertRowid);

    console.log(`✅ Saved edited image as new: ID ${newImageId}, path: ${relativeImagePath}`);
    return newImageId;
  }

  /**
   * Create a blank mask image
   */
  static async createBlankMask(width: number, height: number): Promise<Buffer> {
    return await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 } // Black mask
      }
    })
      .png()
      .toBuffer();
  }

  /**
   * Merge mask with base color (for visualization)
   */
  static async visualizeMask(
    maskBuffer: Buffer,
    color: { r: number; g: number; b: number } = { r: 255, g: 0, b: 0 },
    opacity: number = 0.5
  ): Promise<Buffer> {
    // Create colored overlay
    const maskMetadata = await sharp(maskBuffer).metadata();
    const width = maskMetadata.width || 0;
    const height = maskMetadata.height || 0;

    const colorOverlay = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: color.r, g: color.g, b: color.b, alpha: opacity }
      }
    }).png().toBuffer();

    // Composite mask with color
    return await sharp(maskBuffer)
      .composite([{
        input: colorOverlay,
        blend: 'multiply'
      }])
      .png()
      .toBuffer();
  }
}
