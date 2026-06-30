import fs from 'fs';
import path from 'path';

import { runtimePaths } from '../../config/runtimePaths';

const CHARACTER_IMAGE_DIRECTORY_NAME = 'character-images';
const CHARACTER_IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif']);
export const CHARACTER_IMAGE_CACHE_TTL_MS = 60_000;

export interface DanbooruBrowserCharacterImageRecord {
  fileName: string;
  url: string;
}

interface CharacterImageDirectoryCacheEntry {
  expiresAt: number;
  directory: string | null;
}

interface CharacterImageRecordsCacheEntry {
  expiresAt: number;
  records: DanbooruBrowserCharacterImageRecord[];
}

interface CharacterImageRow {
  tag_id: number;
  name: string;
  normalized_name: string;
}

function sanitizeCharacterImageDirectoryName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[.\s]+$/g, '');
  return sanitized || 'character';
}

function isCharacterImageFile(fileName: string): boolean {
  return CHARACTER_IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function buildCharacterImageUrl(tagId: number, fileName: string): string {
  return `/api/danbooru-browser/character-images/${tagId}/${encodeURIComponent(fileName)}`;
}

export class DanbooruCharacterImageStore {
  private characterImageDirectoryByTagId = new Map<number, CharacterImageDirectoryCacheEntry>();
  private characterImageRecordsByTagId = new Map<number, CharacterImageRecordsCacheEntry>();

  clear(): void {
    this.characterImageDirectoryByTagId.clear();
    this.characterImageRecordsByTagId.clear();
  }

  getRecords(row: CharacterImageRow): DanbooruBrowserCharacterImageRecord[] {
    const now = Date.now();
    const cached = this.characterImageRecordsByTagId.get(row.tag_id);
    if (cached && cached.expiresAt > now) {
      return cached.records;
    }

    const directory = this.getDirectory(row);
    if (!directory) {
      this.characterImageRecordsByTagId.set(row.tag_id, {
        records: [],
        expiresAt: now + CHARACTER_IMAGE_CACHE_TTL_MS,
      });
      return [];
    }

    const records = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isCharacterImageFile(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
      .map((fileName) => ({
        fileName,
        url: buildCharacterImageUrl(row.tag_id, fileName),
      }));
    this.characterImageRecordsByTagId.set(row.tag_id, {
      records,
      expiresAt: now + CHARACTER_IMAGE_CACHE_TTL_MS,
    });
    return records;
  }

  getFilePath(row: CharacterImageRow, fileName: string): string | null {
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
      return null;
    }

    const directory = this.getDirectory(row);
    if (!directory) {
      return null;
    }

    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || !isCharacterImageFile(fileName)) {
      return null;
    }

    return filePath;
  }

  private getRootDirectory(): string {
    return path.join(runtimePaths.databaseDir, CHARACTER_IMAGE_DIRECTORY_NAME);
  }

  private resolveCharacterImageDirectory(row: CharacterImageRow): string | null {
    const rootDirectory = this.getRootDirectory();
    if (!fs.existsSync(rootDirectory)) {
      return null;
    }

    const candidates = Array.from(new Set([
      row.name,
      row.normalized_name,
      sanitizeCharacterImageDirectoryName(row.name),
      sanitizeCharacterImageDirectoryName(row.normalized_name),
      `${sanitizeCharacterImageDirectoryName(row.name)}__${row.tag_id}`,
      `${sanitizeCharacterImageDirectoryName(row.normalized_name)}__${row.tag_id}`,
    ].filter(Boolean)));

    for (const candidate of candidates) {
      const candidatePath = path.join(rootDirectory, candidate);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
        return candidatePath;
      }
    }

    return null;
  }

  private getDirectory(row: CharacterImageRow): string | null {
    const now = Date.now();
    const cached = this.characterImageDirectoryByTagId.get(row.tag_id);
    if (cached && cached.expiresAt > now) {
      return cached.directory;
    }

    const directory = this.resolveCharacterImageDirectory(row);
    this.characterImageDirectoryByTagId.set(row.tag_id, {
      directory,
      expiresAt: now + CHARACTER_IMAGE_CACHE_TTL_MS,
    });
    return directory;
  }
}
