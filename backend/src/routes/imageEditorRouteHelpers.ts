import fs from 'fs';
import path from 'path';
import { publicUrls, runtimePaths } from '../config/runtimePaths';
import { DirectoryListingSnapshots, pageDirectorySnapshot, sortDirectoryItems, type DirectoryPageRequest } from '../services/directoryListingSnapshot';

const SAVE_BROWSER_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const saveSnapshots = new DirectoryListingSnapshots<SaveBrowserImageListItem>();

export type SaveBrowserImageListItem = {
  id: string;
  relative_path: string;
  file_name: string;
  url: string;
  mime_type: string;
  file_size: number;
  modified_at: string;
};

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

function saveImageOrder(item: SaveBrowserImageListItem) {
  return { name: item.file_name, key: item.relative_path, modifiedAt: item.modified_at };
}

async function scanSaveBrowserImages(): Promise<SaveBrowserImageListItem[]> {
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

  return sortDirectoryItems(items, saveImageOrder);
}

/** The no-argument form preserves the original complete listing. */
export async function listSaveBrowserImages(): Promise<SaveBrowserImageListItem[]> {
  return scanSaveBrowserImages();
}

export async function listSaveBrowserImagePage(options: DirectoryPageRequest) {
  const snapshot = await saveSnapshots.read(runtimePaths.saveDir, scanSaveBrowserImages, options);
  return pageDirectorySnapshot(snapshot, options, saveImageOrder);
}
