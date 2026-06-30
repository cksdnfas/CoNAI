import type { Request, Response } from 'express';
import { ImageFileModel } from '../models/Image/ImageFileModel';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { ImageSafetyService } from '../services/imageSafetyService';
import { MediaPostprocessVisibilityService } from '../services/mediaPostprocessVisibilityService';
import { resolveCanvasFilePath } from './imageEditorRouteHelpers';
import { parseRouteIntegerParam, sendRouteBadRequest } from './routeValidation';

const INVALID_IMAGE_ID_ERROR = 'Invalid image ID';
const IMAGE_DATA_REQUIRED_ERROR = 'Image data is required';

function parseImageEditorRouteId(value: string | string[] | undefined) {
  return parseRouteIntegerParam(value);
}

export function requireImageEditorRouteId(req: Request, res: Response) {
  const imageId = parseImageEditorRouteId(req.params.id);
  if (Number.isNaN(imageId)) {
    sendRouteBadRequest(res, INVALID_IMAGE_ID_ERROR);
    return null;
  }

  return imageId;
}

export function requireImageData(res: Response, imageData: unknown) {
  if (!imageData) {
    return sendRouteBadRequest(res, IMAGE_DATA_REQUIRED_ERROR);
  }

  return true;
}

export function getCanvasFilePathOrBlock(filename: string, res: Response) {
  const filePath = resolveCanvasFilePath(filename);

  if (!filePath) {
    res.status(403).json({
      success: false,
      error: 'Access denied',
    });
    return null;
  }

  return filePath;
}

async function getAccessibleImageFileOrBlock(imageId: number, res: Response) {
  const imageFile = ImageFileModel.findById(imageId);
  if (!imageFile) {
    res.status(404).json({
      success: false,
      error: 'Image file not found',
    });
    return null;
  }

  if (imageFile.composite_hash) {
    const metadata = await MediaMetadataModel.findByHash(imageFile.composite_hash);
    if (metadata && !MediaPostprocessVisibilityService.isReadyRecord(metadata)) {
      res.status(404).json({
        success: false,
        error: 'Image file not found',
      });
      return null;
    }

    if (metadata && ImageSafetyService.isHidden(metadata.rating_score)) {
      res.status(403).json({
        success: false,
        error: 'This image is hidden by the current safety policy',
      });
      return null;
    }
  }

  return imageFile;
}

export async function requireAccessibleImageEditorRequest(req: Request, res: Response) {
  const imageId = requireImageEditorRouteId(req, res);
  if (imageId === null) {
    return null;
  }

  const imageFile = await getAccessibleImageFileOrBlock(imageId, res);
  if (!imageFile) {
    return null;
  }

  return {
    imageId,
    imageFile,
  };
}
