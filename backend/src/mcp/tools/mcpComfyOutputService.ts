import fs from 'fs';
import path from 'path';
import { GenerationHistoryModel } from '../../models/GenerationHistory';
import { APIImageProcessor } from '../../services/APIImageProcessor';
import { BackgroundProcessorService } from '../../services/backgroundProcessorService';

export async function cleanupMcpComfyTempFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
      console.warn(`[MCP ComfyUI] Failed to cleanup temp output ${filePath}:`, error);
    }
  }
}

/** Save one MCP Comfy output through the same media pipeline used by normal generation. */
export async function processMcpComfyOutput(historyId: number, sourceFilePath: string): Promise<string | null> {
  try {
    GenerationHistoryModel.updateStatus(historyId, 'processing');

    const processedPaths = await APIImageProcessor.processGeneratedFile(sourceFilePath, 'comfyui', {
      sourcePathForMetadata: sourceFilePath,
      originalFileName: path.basename(sourceFilePath),
    });

    GenerationHistoryModel.updateImagePaths(historyId, {
      compositeHash: processedPaths.compositeHash,
    });
    await BackgroundProcessorService.processApiGenerationGroupAssignmentForHash(processedPaths.compositeHash);
    GenerationHistoryModel.updateStatus(historyId, 'completed');

    return processedPaths.originalPath;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    GenerationHistoryModel.recordError(historyId, errorMessage);
    console.error(`[MCP ComfyUI] Failed to process generated output for history ${historyId}:`, errorMessage);
    return null;
  } finally {
    await cleanupMcpComfyTempFile(sourceFilePath);
  }
}
