import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';

import { runtimePaths } from '../../config/runtimePaths';

// Match QueryCacheService's typed require: the local ambient declaration describes an older LRU API.
const { LRUCache } = require('lru-cache') as {
  LRUCache: new <K, V>(options: { max: number; ttl: number }) => {
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    delete(key: K): void;
    clear(): void;
  };
};

const CHARACTER_IMAGE_DIRECTORY_NAME = 'character-images';
const CHARACTER_IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif']);
export const CHARACTER_IMAGE_CACHE_TTL_MS = 60_000;
const CHARACTER_IMAGE_CACHE_MAX_ENTRIES = 500;
const CHARACTER_IMAGE_READ_CONCURRENCY = 4;

export interface DanbooruBrowserCharacterImageRecord {
  fileName: string;
  url: string;
}

interface CharacterImageDirectoryCacheEntry {
  directory: Promise<string | null>;
}

interface CharacterImageRecordsCacheEntry {
  records: Promise<DanbooruBrowserCharacterImageRecord[]>;
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
  private characterImageDirectoryByTagId = new LRUCache<number, CharacterImageDirectoryCacheEntry>({
    max: CHARACTER_IMAGE_CACHE_MAX_ENTRIES, ttl: CHARACTER_IMAGE_CACHE_TTL_MS,
  });
  private characterImageRecordsByTagId = new LRUCache<number, CharacterImageRecordsCacheEntry>({
    max: CHARACTER_IMAGE_CACHE_MAX_ENTRIES, ttl: CHARACTER_IMAGE_CACHE_TTL_MS,
  });
  private readImages = pLimit(CHARACTER_IMAGE_READ_CONCURRENCY);

  clear(): void {
    this.characterImageDirectoryByTagId.clear();
    this.characterImageRecordsByTagId.clear();
  }

  getRecords(row: CharacterImageRow): Promise<DanbooruBrowserCharacterImageRecord[]> {
    const cached = this.characterImageRecordsByTagId.get(row.tag_id);
    if (cached) {
      return cached.records;
    }

    const records = this.readImages(async () => {
      const directory = await this.getDirectory(row);
      if (!directory) return [];
      return (await fs.promises.readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && isCharacterImageFile(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
        .map((fileName) => ({
          fileName,
          url: buildCharacterImageUrl(row.tag_id, fileName),
        }));
    });
    // Cache the promise so overlapping list/suggestion requests also share the directory read.
    // Install it before loading; clear() cannot be undone by an older read completing afterwards.
    this.characterImageRecordsByTagId.set(row.tag_id, {
      records,
    });
    void records.catch(() => {
      if (this.characterImageRecordsByTagId.get(row.tag_id)?.records === records) {
        this.characterImageRecordsByTagId.delete(row.tag_id);
      }
    });
    return records;
  }

  async getFilePath(row: CharacterImageRow, fileName: string): Promise<string | null> {
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || !isCharacterImageFile(fileName)) {
      return null;
    }

    return this.readImages(async () => {
      const directory = await this.getDirectory(row);
      if (!directory) return null;
      const filePath = path.join(directory, fileName);
      try {
        return (await fs.promises.stat(filePath)).isFile() ? filePath : null;
      } catch (error) {
        if (isMissingPath(error)) return null;
        throw error;
      }
    });
  }

  private getRootDirectory(): string {
    return path.join(runtimePaths.databaseDir, CHARACTER_IMAGE_DIRECTORY_NAME);
  }

  private async resolveCharacterImageDirectory(row: CharacterImageRow): Promise<string | null> {
    const rootDirectory = this.getRootDirectory();

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
      try {
        if ((await fs.promises.stat(candidatePath)).isDirectory()) return candidatePath;
      } catch (error) {
        if (!isMissingPath(error)) throw error;
      }
    }

    return null;
  }

  private getDirectory(row: CharacterImageRow): Promise<string | null> {
    const cached = this.characterImageDirectoryByTagId.get(row.tag_id);
    if (cached) {
      return cached.directory;
    }

    const directory = this.resolveCharacterImageDirectory(row);
    this.characterImageDirectoryByTagId.set(row.tag_id, {
      directory,
    });
    void directory.catch(() => {
      if (this.characterImageDirectoryByTagId.get(row.tag_id)?.directory === directory) {
        this.characterImageDirectoryByTagId.delete(row.tag_id);
      }
    });
    return directory;
  }
}

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
