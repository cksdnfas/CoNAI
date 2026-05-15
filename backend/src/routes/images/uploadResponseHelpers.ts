import type { UploadResponse } from '../../types/image';

export interface UploadResponseProcessedMedia {
  filename: string;
  width: number | null;
  height: number | null;
  fileSize: number;
}

export interface UploadResponseProcessingResult {
  fileId: number;
  compositeHash: string | null;
}

export function buildUploadResponseData({
  file,
  processedData,
  mediaProcessing,
  mimeType,
  uploadDate = new Date().toISOString(),
}: {
  file: Pick<Express.Multer.File, 'originalname'>;
  processedData: UploadResponseProcessedMedia;
  mediaProcessing: UploadResponseProcessingResult;
  mimeType: string;
  uploadDate?: string;
}): NonNullable<UploadResponse['data']> {
  return {
    id: mediaProcessing.fileId,
    composite_hash: mediaProcessing.compositeHash,
    filename: processedData.filename,
    original_name: file.originalname,
    thumbnail_url: '',
    file_size: processedData.fileSize,
    mime_type: mimeType,
    width: processedData.width,
    height: processedData.height,
    upload_date: uploadDate,
  };
}
