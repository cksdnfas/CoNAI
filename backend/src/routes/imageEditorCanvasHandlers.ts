import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { runtimePaths } from '../config/runtimePaths';
import { WebPConversionService } from '../services/webpConversionService';
import { getCanvasFilePathOrBlock, requireImageData } from './imageEditorAccessHelpers';
import { sendRouteBadRequest } from './routeValidation';

export async function handleCanvasWebp(filename: string, res: Response) {
  try {
    const filePath = getCanvasFilePathOrBlock(filename, res);
    if (!filePath) {
      return;
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    const conversion = await WebPConversionService.convertFileToWebPBuffer(filePath, {
      quality: 100,
      lossless: false,
      sourcePathForMetadata: filePath,
      originalFileName: path.basename(filePath),
      mimeType: 'image/webp',
    });

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'private, max-age=300');
    return res.send(conversion.buffer);
  } catch (error) {
    console.error('Error converting canvas image to WebP:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to convert image',
    });
  }
}

export async function handleSaveCanvasWebp(req: Request, res: Response, filename: string) {
  const { imageData, quality = 90, createNew = false } = req.body;

  if (!requireImageData(res, imageData)) {
    return;
  }

  try {
    const canvasDir = runtimePaths.canvasDir;
    await fs.promises.mkdir(canvasDir, { recursive: true });

    const base64Data = imageData.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const newFileName = createNew
      ? `${path.basename(filename, path.extname(filename))}_${Date.now()}.webp`
      : filename;

    const filePath = getCanvasFilePathOrBlock(newFileName, res);
    if (!filePath) {
      return;
    }

    const metadataSourcePath = fs.existsSync(filePath) ? filePath : undefined;

    const conversion = await WebPConversionService.convertBufferToWebPBuffer(imageBuffer, {
      quality,
      sourcePathForMetadata: metadataSourcePath,
      originalFileName: newFileName,
      mimeType: 'image/webp',
    });

    await fs.promises.writeFile(filePath, conversion.buffer);

    return res.json({
      success: true,
      data: {
        filename: newFileName,
        filePath,
        url: `/save/canvas/${newFileName}`,
        width: conversion.info.width || 0,
        height: conversion.info.height || 0,
        fileSize: conversion.buffer.length,
      },
    });
  } catch (error) {
    console.error('Error saving canvas image:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save canvas image',
    });
  }
}

export async function handleListCanvasImages(res: Response) {
  try {
    const canvasDir = runtimePaths.canvasDir;

    if (!fs.existsSync(canvasDir)) {
      return res.json({
        success: true,
        data: {
          images: [],
          total: 0,
        },
      });
    }

    const files = await fs.promises.readdir(canvasDir);
    const imageExtensions = ['.webp', '.png', '.jpg', '.jpeg'];

    const imageFiles = await Promise.all(
      files
        .filter((file) => imageExtensions.some((ext) => file.toLowerCase().endsWith(ext)))
        .map(async (file) => {
          const filePath = path.join(canvasDir, file);
          const stats = await fs.promises.stat(filePath);

          let width = 0;
          let height = 0;
          try {
            const metadata = await sharp(filePath).metadata();
            width = metadata.width || 0;
            height = metadata.height || 0;
          } catch {
            // Best-effort metadata only; broken images can still be listed.
          }

          return {
            filename: file,
            path: filePath,
            url: `/save/canvas/${file}`,
            size: stats.size,
            width,
            height,
            createdAt: stats.birthtime.toISOString(),
            modifiedAt: stats.mtime.toISOString(),
          };
        }),
    );

    imageFiles.sort((a, b) =>
      new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
    );

    return res.json({
      success: true,
      data: {
        images: imageFiles,
        total: imageFiles.length,
      },
    });
  } catch (error) {
    console.error('Error listing canvas images:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list canvas images',
    });
  }
}

export async function handleDeleteCanvasImage(filename: string, res: Response) {
  try {
    const filePath = getCanvasFilePathOrBlock(filename, res);
    if (!filePath) {
      return;
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    await fs.promises.unlink(filePath);

    return res.json({
      success: true,
      message: 'Canvas image deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting canvas image:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete canvas image',
    });
  }
}
