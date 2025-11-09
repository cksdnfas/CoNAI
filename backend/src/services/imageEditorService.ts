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
    // Get original image info from image_files table
    const imageFile = ImageFileModel.findById(imageId);
    if (!imageFile) {
      throw new Error(`Image file not found: ${imageId}`);
    }

    // original_file_path is already an absolute path
    const originalPath = imageFile.original_file_path;

    if (!fs.existsSync(originalPath)) {
      throw new Error(`Image file not found: ${imageFile.original_file_path}`);
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

    // If no edits, just clone the image
    if (!editOptions.crop && !editOptions.resize) {
      imageProcessor = imageProcessor.clone();
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

      // Convert ArrayBuffer to Buffer
      const maskBuffer = Buffer.from(editOptions.mask.data);

      // Save mask as grayscale PNG
      await sharp(maskBuffer)
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
   * Save edited canvas image to temp/canvas directory
   * Simply saves the provided image data without re-processing from original
   */
  static async saveEditedImageAsNew(
    imageData: Buffer,
    imageId: number,
    maskData?: Buffer,
    expirationMinutes: number = 30
  ): Promise<EditResult> {
    // Create temp ID and paths
    const tempId = TempImageService.createTempId();
    const tempImagePath = TempImageService.getTempFilePath(tempId, 'image');

    // Save edited image directly
    await sharp(imageData).png().toFile(tempImagePath);

    // Get final dimensions
    const metadata = await sharp(tempImagePath).metadata();
    const finalWidth = metadata.width || 0;
    const finalHeight = metadata.height || 0;

    // Handle mask if provided
    let tempMaskPath: string | undefined;
    if (maskData) {
      tempMaskPath = TempImageService.getTempFilePath(tempId, 'mask');
      await sharp(maskData).greyscale().png().toFile(tempMaskPath);
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
