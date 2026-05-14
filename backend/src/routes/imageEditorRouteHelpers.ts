import fs from 'fs';
import path from 'path';
import { publicUrls, runtimePaths } from '../config/runtimePaths';
import type { EditResult } from '../services/imageEditorService';

const SAVE_BROWSER_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export type SaveBrowserImageListItem = {
  id: string;
  relative_path: string;
  file_name: string;
  url: string;
  mime_type: string;
  file_size: number;
  modified_at: string;
};

/** Resolve a child path only when it stays below the given directory. */
export function resolveChildPathWithinDirectory(directoryPath: string, childPath: string) {
  const resolvedDirectory = path.resolve(directoryPath);
  const resolvedChild = path.resolve(resolvedDirectory, childPath);
  const relativePath = path.relative(resolvedDirectory, resolvedChild);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return resolvedChild;
}

/** Resolve a canvas file path and reject sibling-prefix traversal. */
export function resolveCanvasFilePath(filename: string) {
  return resolveChildPathWithinDirectory(runtimePaths.canvasDir, filename);
}

/** Normalize one relative save-path segment for browser-safe URL generation. */
function toSaveBrowserRelativePath(filePath: string) {
  return path.relative(runtimePaths.saveDir, filePath).replace(/\\/g, '/');
}

/** Walk the save directory recursively and collect image files for picker UIs. */
async function collectSaveBrowserImagePaths(directoryPath: string): Promise<string[]> {
  const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  const collected: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      collected.push(...await collectSaveBrowserImagePaths(fullPath));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (SAVE_BROWSER_IMAGE_EXTENSIONS.has(extension)) {
      collected.push(fullPath);
    }
  }

  return collected;
}

/** List save-folder images for attachment picker UIs. */
export async function listSaveBrowserImages(): Promise<SaveBrowserImageListItem[]> {
  if (!fs.existsSync(runtimePaths.saveDir)) {
    return [];
  }

  const filePaths = await collectSaveBrowserImagePaths(runtimePaths.saveDir);
  const items = await Promise.all(
    filePaths.map(async (filePath) => {
      const stats = await fs.promises.stat(filePath);
      const relativePath = toSaveBrowserRelativePath(filePath);

      return {
        id: relativePath,
        relative_path: relativePath,
        file_name: path.basename(filePath),
        url: `${publicUrls.saveBaseUrl}/${relativePath.split('/').map(encodeURIComponent).join('/')}`,
        mime_type: `image/${path.extname(filePath).replace('.', '').toLowerCase() || 'png'}`,
        file_size: stats.size,
        modified_at: stats.mtime.toISOString(),
      };
    }),
  );

  items.sort((left, right) => new Date(right.modified_at).getTime() - new Date(left.modified_at).getTime());

  return items;
}

/** Build the shared response payload returned by temporary editor save routes. */
export function buildImageEditorResultData(result: EditResult, options?: { message?: string }) {
  return {
    tempId: result.tempId,
    tempImagePath: result.tempImagePath,
    tempMaskPath: result.tempMaskPath,
    expiresAt: result.expiresAt,
    width: result.width,
    height: result.height,
    ...(options?.message ? { message: options.message } : {}),
  };
}
