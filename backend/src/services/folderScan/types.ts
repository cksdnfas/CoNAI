export interface ScanResult {
  folderId: number;
  totalScanned: number;
  newImages: number;
  existingImages: number;
  updatedPaths: number;
  missingImages: number;
  errors: Array<{ file: string; error: string }>;
  duration: number;
  thumbnailsGenerated: number;
  backgroundTasks: number;
}

export interface ProcessedFileData {
  filePath: string;
  stats: any;
  mimeType: string;
  hashes?: {
    compositeHash: string;
    perceptualHash: string;
    dHash: string;
    aHash: string;
  };
  colorHistogram?: any;
}