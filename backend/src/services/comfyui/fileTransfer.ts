import axios, { type AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import FormData from 'form-data';
import { runtimePaths } from '../../config/runtimePaths';

export async function downloadComfyOutputFile(
  axiosInstance: AxiosInstance,
  filename: string,
  subfolder: string = '',
  type: string = 'output',
  signal?: AbortSignal,
): Promise<string> {
  const tempFilePath = path.join(runtimePaths.tempDir, `comfyui_${randomUUID()}${path.extname(filename)}`);
  let created = false;
  try {
    const params = new URLSearchParams({
      filename,
      subfolder,
      type,
    });
    const url = `/view?${params.toString()}`;

    await fs.promises.mkdir(runtimePaths.tempDir, { recursive: true });
    const file = await fs.promises.open(tempFilePath, 'wx');
    created = true;
    let response;
    try {
      response = await axiosInstance.get(url, { responseType: 'stream', signal });
    } catch (error) {
      if (axios.isAxiosError(error)) error.response?.data?.destroy?.();
      try { await file.close(); }
      catch (cleanupError) {
        console.warn(`⚠️ Failed to close temp ComfyUI output ${tempFilePath}:`, cleanupError);
        if (error && typeof error === 'object') Object.assign(error, { cleanupError });
      }
      throw error;
    }
    await pipeline(response.data, file.createWriteStream(), { signal });

    return tempFilePath;
  } catch (error) {
    if (created) {
      try { await fs.promises.rm(tempFilePath, { force: true }); }
      catch (failure) {
        console.warn(`⚠️ Failed to remove temp ComfyUI output ${tempFilePath}:`, failure);
        if (error && typeof error === 'object') {
          const previous = (error as { cleanupError?: unknown }).cleanupError;
          Object.assign(error, { cleanupError: previous ? [previous, failure] : failure });
        }
      }
    }
    if (axios.isAxiosError(error)) {
      throw Object.assign(new Error(`ComfyUI output download error: ${error.message}`), (error as { cleanupError?: unknown }).cleanupError ? { cleanupError: (error as { cleanupError?: unknown }).cleanupError } : {});
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
