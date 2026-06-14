import axios, { type AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import { runtimePaths } from '../../config/runtimePaths';

export async function downloadComfyOutputFile(
  axiosInstance: AxiosInstance,
  filename: string,
  subfolder: string = '',
  type: string = 'output'
): Promise<string> {
  try {
    const params = new URLSearchParams({
      filename,
      subfolder,
      type,
    });
    const url = `/view?${params.toString()}`;

    const response = await axiosInstance.get(url, {
      responseType: 'arraybuffer',
    });

    const tempDir = runtimePaths.tempDir;
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const ext = path.extname(filename);
    const uniqueFilename = `comfyui_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
    const tempFilePath = path.join(tempDir, uniqueFilename);
    fs.writeFileSync(tempFilePath, Buffer.from(response.data));

    return tempFilePath;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`ComfyUI output download error: ${error.message}`);
    }
    throw error;
  }
}

export async function uploadComfyInputImage(
  axiosInstance: AxiosInstance,
  fileName: string,
  imageInput: Buffer | fs.ReadStream,
  options?: { contentType?: string }
): Promise<string> {
  try {
    const formData = new FormData();
    formData.append('image', imageInput, {
      filename: fileName,
      contentType: options?.contentType || 'image/png',
    });
    formData.append('type', 'input');
    formData.append('overwrite', 'false');

    const response = await axiosInstance.post('/upload/image', formData, {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
    });

    return response.data?.name || fileName;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`ComfyUI image upload error: ${error.message}`);
    }
    throw error;
  }
}
