import type { Response } from 'express';
import fs from 'fs';
import { TempImageService } from '../services/tempImageService';

export async function handleDeleteTempImage(tempId: string, res: Response) {
  try {
    await TempImageService.deleteTempFile(tempId);

    return res.json({
      success: true,
      message: 'Temporary file deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting temp file:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete temporary file',
    });
  }
}

export async function handleTempImageFile(tempId: string, res: Response) {
  const tempInfo = TempImageService.getTempFileInfo(tempId);

  if (!tempInfo) {
    return res.status(404).json({
      success: false,
      error: 'Temporary file not found',
    });
  }

  if (!fs.existsSync(tempInfo.tempPath)) {
    return res.status(404).json({
      success: false,
      error: 'Temporary file no longer exists',
    });
  }

  if (new Date() > tempInfo.expiresAt) {
    await TempImageService.deleteTempFile(tempId);
    return res.status(410).json({
      success: false,
      error: 'Temporary file has expired',
    });
  }

  return res.sendFile(tempInfo.tempPath);
}

export async function handleTempMaskFile(tempId: string, res: Response) {
  const tempInfo = TempImageService.getTempFileInfo(tempId);

  if (!tempInfo || !tempInfo.tempMaskPath) {
    return res.status(404).json({
      success: false,
      error: 'Temporary mask file not found',
    });
  }

  if (!fs.existsSync(tempInfo.tempMaskPath)) {
    return res.status(404).json({
      success: false,
      error: 'Temporary mask file no longer exists',
    });
  }

  if (new Date() > tempInfo.expiresAt) {
    await TempImageService.deleteTempFile(tempId);
    return res.status(410).json({
      success: false,
      error: 'Temporary file has expired',
    });
  }

  return res.sendFile(tempInfo.tempMaskPath);
}

export function handleTempImageList(res: Response) {
  const tempFiles = TempImageService.getAllTempFiles();
  const stats = TempImageService.getStats();

  return res.json({
    success: true,
    data: {
      stats,
      files: tempFiles,
    },
  });
}
