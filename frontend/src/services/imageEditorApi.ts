import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1566';

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
    const response = await axios.post<TempImageResponse>(
      `${API_BASE_URL}/api/image-editor/${imageId}/temp`,
      editOptions
    );
    return response.data;
  },

  /**
   * Save edited image as new permanent image
   */
  async saveEditedImage(
    imageId: number,
    editOptions: EditOptions,
    customName?: string
  ): Promise<SaveImageResponse> {
    const response = await axios.post<SaveImageResponse>(
      `${API_BASE_URL}/api/image-editor/${imageId}/save`,
      { editOptions, customName }
    );
    return response.data;
  },

  /**
   * Delete temporary file
   */
  async deleteTempFile(tempId: string): Promise<{ success: boolean; message: string }> {
    const response = await axios.delete(
      `${API_BASE_URL}/api/image-editor/temp/${tempId}`
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
    const response = await axios.post(`${API_BASE_URL}/api/image-editor/mask/blank`, {
      width,
      height
    });
    return response.data;
  },

  /**
   * Get temp files stats (for debugging)
   */
  async getTempFilesStats(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/api/image-editor/temp`);
    return response.data;
  }
};
