import type { Router, Request, Response } from 'express';
import { successResponse, errorResponse } from '@conai/shared';
import { uploadSingle } from '../../middleware/upload';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageProcessor } from '../../services/imageProcessor';
import { imageTaggerService } from '../../services/imageTaggerService';
import { kaloscopeTaggerService } from '../../services/kaloscopeTaggerService';
import { ImageMetadataWriteService } from '../../services/imageMetadataWriteService';
import { WebPConversionService } from '../../services/webpConversionService';
import {
  buildDownloadFileName,
  buildExtractedImagePreview,
  buildOutputMimeType,
  cleanupTemporaryUpload,
  getSingleUploadedFile,
  isImageFile,
  parseMetadataPatch,
  resolveOutputFormat,
} from './uploadRouteHelpers';

type UploadedImageFile = Express.Multer.File & { path: string };

/** Send one metadata utility 400 response without changing the existing envelope. */
function sendUploadMetadataBadRequest(res: Response, error: string) {
  return res.status(400).json(errorResponse(error));
}

/** Resolve one uploaded image file only after the shared metadata utility guards pass. */
function getValidatedUploadMetadataFile(
  req: Request,
  res: Response,
  invalidImageMessage: string,
): UploadedImageFile | null {
  const file = getSingleUploadedFile(req);

  if (!file) {
    sendUploadMetadataBadRequest(res, 'No file uploaded');
    return null;
  }

  if (!isImageFile(file.mimetype)) {
    sendUploadMetadataBadRequest(res, invalidImageMessage);
    return null;
  }

  if (!file.path) {
    res.status(500).json(errorResponse('Temporary upload path is missing'));
    return null;
  }

  return file as UploadedImageFile;
}

/** Register metadata-only utility routes that work without saving uploads into the library. */
export function registerUploadMetadataUtilityRoutes(router: Router): void {
  /** Convert one uploaded image to WebP without storing it in the library. */
  router.post('/convert-webp', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    const file = getValidatedUploadMetadataFile(req, res, 'Only image files can be converted to WebP');
    if (!file) {
      return;
    }

    const rawQuality = typeof req.body?.quality === 'string' ? Number(req.body.quality) : Number(req.body?.quality ?? 90);

    try {
      const conversion = await WebPConversionService.convertFileToWebPBuffer(file.path, {
        quality: Number.isFinite(rawQuality) ? rawQuality : 90,
        sourcePathForMetadata: file.path,
        originalFileName: file.originalname,
        mimeType: file.mimetype,
      });

      const downloadName = buildDownloadFileName(file.originalname, 'webp');
      const encodedName = encodeURIComponent(downloadName);

      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"; filename*=UTF-8''${encodedName}`);
      res.setHeader('X-CoNAI-WebP-Metadata', conversion.embeddedPayload ? 'preserved' : 'empty');

      return res.send(conversion.buffer);
    } catch (error) {
      console.error('❌ Convert WebP error:', error);
      return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'WebP conversion failed'));
    } finally {
      await cleanupTemporaryUpload(file);
    }
  }));

  /** Rewrite image metadata without saving the upload to the library. */
  router.post('/rewrite-metadata', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    const file = getValidatedUploadMetadataFile(req, res, 'Only image files can be rewritten without upload');
    if (!file) {
      return;
    }

    const outputFormat = resolveOutputFormat(req.body?.format, file);
    const rawQuality = typeof req.body?.quality === 'string' ? Number(req.body.quality) : Number(req.body?.quality ?? 90);

    try {
      const metadataPatch = parseMetadataPatch(req.body?.metadataPatch);
      const rewritten = await ImageMetadataWriteService.writeFileAsFormatBuffer(file.path, {
        format: outputFormat,
        quality: Number.isFinite(rawQuality) ? rawQuality : 90,
        sourcePathForMetadata: file.path,
        originalFileName: file.originalname,
        mimeType: file.mimetype,
        metadataPatch,
      });

      const downloadName = buildDownloadFileName(file.originalname, outputFormat);
      const encodedName = encodeURIComponent(downloadName);

      res.setHeader('Content-Type', buildOutputMimeType(outputFormat));
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"; filename*=UTF-8''${encodedName}`);
      res.setHeader('X-CoNAI-Metadata-Rewrite', metadataPatch ? 'patched' : 'preserved');
      res.setHeader('X-CoNAI-Metadata-XMP', rewritten.xmpApplied ? 'applied' : 'empty');
      res.setHeader('X-CoNAI-Metadata-EXIF', rewritten.exifApplied ? 'applied' : 'empty');

      return res.send(rewritten.buffer);
    } catch (error) {
      console.error('❌ Rewrite metadata error:', error);
      if (error instanceof Error && error.message === 'metadataPatch must be a JSON object') {
        return res.status(400).json(errorResponse(error.message));
      }
      return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Metadata rewrite failed'));
    } finally {
      await cleanupTemporaryUpload(file);
    }
  }));

  /** Extract metadata and prompt preview information from one uploaded image. */
  router.post('/extract-metadata', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    const file = getValidatedUploadMetadataFile(req, res, 'Only image files can be extracted without upload');
    if (!file) {
      return;
    }

    try {
      const [metadata, imageInfo] = await Promise.all([
        ImageProcessor.extractMetadata(file.path),
        ImageProcessor.getImageInfo(file.path),
      ]);

      return res.json(successResponse(buildExtractedImagePreview(file, metadata, imageInfo)));
    } catch (error) {
      console.error('❌ Extract metadata error:', error);
      return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Metadata extraction failed'));
    } finally {
      await cleanupTemporaryUpload(file);
    }
  }));

  /** Extract tagger results from one uploaded image without saving it. */
  router.post('/extract-tagger', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    const file = getValidatedUploadMetadataFile(req, res, 'Only image files can be tag-extracted without upload');
    if (!file) {
      return;
    }

    try {
      const result = await imageTaggerService.tagImage(file.path);

      if (!result.success) {
        return res.status(500).json(errorResponse(result.error || 'Tagger extraction failed'));
      }

      return res.json(successResponse(result));
    } catch (error) {
      console.error('❌ Extract tagger error:', error);
      return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Tagger extraction failed'));
    } finally {
      await cleanupTemporaryUpload(file);
    }
  }));

  /** Extract kaloscope artist results from one uploaded image without saving it. */
  router.post('/extract-kaloscope', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    const file = getValidatedUploadMetadataFile(req, res, 'Only image files can be artist-extracted without upload');
    if (!file) {
      return;
    }

    try {
      const result = await kaloscopeTaggerService.tagImage(file.path);

      if (!result.success) {
        return res.status(500).json(errorResponse(result.error || 'Kaloscope extraction failed'));
      }

      return res.json(successResponse(result));
    } catch (error) {
      console.error('❌ Extract kaloscope error:', error);
      return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Kaloscope extraction failed'));
    } finally {
      await cleanupTemporaryUpload(file);
    }
  }));
}
