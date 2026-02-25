import apiClient, { API_BASE_URL } from './api/apiClient';

export interface EditOptions {
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  resize?: {
    width: number;
    height: number;
  };
  mask?: {
    data: ArrayBuffer; // PNG buffer for mask image
  };
}

export interface TempImageResponse {
  success: boolean;
  data?: {
    tempId: string;
    tempImagePath: string;
    tempMaskPath?: string;
    expiresAt: string;
    width: number;
    height: number;
  };
  error?: string;
}

export interface SaveImageResponse {
  success: boolean;
  data?: {
    newImageId: number;
    message: string;
  };
  error?: string;
}

export interface CanvasImage {
  filename: string;
  path: string;
  url: string;
  size: number;
  width: number;
  height: number;
  createdAt: string;
  modifiedAt: string;
}

export interface CanvasImagesResponse {
  success: boolean;
  data?: {
    images: CanvasImage[];
    total: number;
  };
  error?: string;
}

/**
 * Image Editor API Service
 */
export const imageEditorApi = {
  /**
   * Create temporary edited image (volatile - for API transmission)
   */
  async createTempEditedImage(
    imageId: number,
    editOptions: EditOptions
  ): Promise<TempImageResponse> {
    const response = await apiClient.post<TempImageResponse>(
      `/api/image-editor/${imageId}/temp`,
      editOptions
    );
    return response.data;
  },

  /**
   * Save edited canvas image to temp/canvas directory
   */
  async saveEditedImage(
    imageId: number,
    imageData: string,
    maskData?: string
  ): Promise<SaveImageResponse> {
    const response = await apiClient.post<SaveImageResponse>(
      `/api/image-editor/${imageId}/save`,
      { imageData, maskData }
    );
    return response.data;
  },

  /**
   * Delete temporary file
   */
  async deleteTempFile(tempId: string): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.delete(
      `/api/image-editor/temp/${tempId}`
    );
    return response.data;
  },

  /**
   * Get temporary image URL
   */
  getTempImageUrl(tempId: string): string {
    return `${API_BASE_URL}/api/image-editor/temp/${tempId}/image`;
  },

  /**
   * Get temporary mask URL
   */
  getTempMaskUrl(tempId: string): string {
    return `${API_BASE_URL}/api/image-editor/temp/${tempId}/mask`;
  },

  /**
   * Create blank mask
   */
  async createBlankMask(
    width: number,
    height: number
  ): Promise<{ success: boolean; data?: { mask: string; width: number; height: number } }> {
    const response = await apiClient.post('/api/image-editor/mask/blank', {
      width,
      height
    });
    return response.data;
  },

  /**
   * Get temp files stats (for debugging)
   */
  async getTempFilesStats(): Promise<any> {
    const response = await apiClient.get('/api/image-editor/temp');
    return response.data;
  },

  /**
   * Get all canvas images (saved edited images)
   */
  async getCanvasImages(): Promise<CanvasImagesResponse> {
    const response = await apiClient.get<CanvasImagesResponse>(
      '/api/image-editor/canvas'
    );
    return response.data;
  },

  /**
   * Delete a canvas image
   */
  async deleteCanvasImage(filename: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const response = await apiClient.delete(
      `/api/image-editor/canvas/${encodeURIComponent(filename)}`
    );
    return response.data;
  }
};
