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
  buildExtractedImagePreview,
  parseMetadataPatch,
  parseMultipartNumber,
  resolveOutputFormat,
  setDownloadResponseHeaders,
  withValidatedUploadedImageFile,
} from './uploadRouteHelpers';

/** Register metadata-only utility routes that work without saving uploads into the library. */
export function registerUploadMetadataUtilityRoutes(router: Router): void {
  /** Convert one uploaded image to WebP without storing it in the library. */
  router.post('/convert-webp', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    return withValidatedUploadedImageFile(req, res, 'Only image files can be converted to WebP', async (file) => {
      try {
        const conversion = await WebPConversionService.convertFileToWebPBuffer(file.path, {
          quality: parseMultipartNumber(req.body?.quality, 90),
          sourcePathForMetadata: file.path,
          originalFileName: file.originalname,
          mimeType: file.mimetype,
        });

        setDownloadResponseHeaders(res, file.originalname, 'webp');
        res.setHeader('X-CoNAI-WebP-Metadata', conversion.embeddedPayload ? 'preserved' : 'empty');

        return res.send(conversion.buffer);
      } catch (error) {
        console.error('❌ Convert WebP error:', error);
        return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'WebP conversion failed'));
      }
    });
  }));

  /** Rewrite image metadata without saving the upload to the library. */
  router.post('/rewrite-metadata', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    return withValidatedUploadedImageFile(req, res, 'Only image files can be rewritten without upload', async (file) => {
      const outputFormat = resolveOutputFormat(req.body?.format, file);

      try {
        const metadataPatch = parseMetadataPatch(req.body?.metadataPatch);
        const rewritten = await ImageMetadataWriteService.writeFileAsFormatBuffer(file.path, {
          format: outputFormat,
          quality: parseMultipartNumber(req.body?.quality, 90),
          sourcePathForMetadata: file.path,
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          metadataPatch,
        });

        setDownloadResponseHeaders(res, file.originalname, outputFormat);
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
      }
    });
  }));

  /** Extract metadata and prompt preview information from one uploaded image. */
  router.post('/extract-metadata', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    return withValidatedUploadedImageFile(req, res, 'Only image files can be extracted without upload', async (file) => {
      try {
        const [metadata, imageInfo] = await Promise.all([
          ImageProcessor.extractMetadata(file.path),
          ImageProcessor.getImageInfo(file.path),
        ]);

        return res.json(successResponse(buildExtractedImagePreview(file, metadata, imageInfo)));
      } catch (error) {
        console.error('❌ Extract metadata error:', error);
        return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Metadata extraction failed'));
      }
    });
  }));

  /** Extract tagger results from one uploaded image without saving it. */
  router.post('/extract-tagger', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    return withValidatedUploadedImageFile(req, res, 'Only image files can be tag-extracted without upload', async (file) => {
      try {
        const result = await imageTaggerService.tagImage(file.path);

        if (!result.success) {
          return res.status(500).json(errorResponse(result.error || 'Tagger extraction failed'));
        }

        return res.json(successResponse(result));
      } catch (error) {
        console.error('❌ Extract tagger error:', error);
        return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Tagger extraction failed'));
      }
    });
  }));

  /** Extract kaloscope artist results from one uploaded image without saving it. */
  router.post('/extract-kaloscope', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
    return withValidatedUploadedImageFile(req, res, 'Only image files can be artist-extracted without upload', async (file) => {
      try {
        const result = await kaloscopeTaggerService.tagImage(file.path);

        if (!result.success) {
          return res.status(500).json(errorResponse(result.error || 'Kaloscope extraction failed'));
        }

        return res.json(successResponse(result));
      } catch (error) {
        console.error('❌ Extract kaloscope error:', error);
        return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Kaloscope extraction failed'));
      }
    });
  }));
}
