import fs from 'fs';
import path from 'path';
import { db } from '../database/init';
import { resolveUploadsPath } from '../config/runtimePaths';

interface AutoTestMediaRow {
  composite_hash: string;
  thumbnail_path: string | null;
  width: number | null;
  height: number | null;
  original_file_path: string | null;
  file_mime_type: string | null;
  file_type: string | null;
  file_size: number | null;
}

export interface AutoTestMediaPayload {
  compositeHash: string;
  fileName: string | null;
  originalFilePath: string | null;
  mimeType: string | null;
  fileType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  existsOnDisk: boolean;
  thumbnailUrl: string | null;
  imageUrl: string | null;
}

export interface AutoTestMediaFileTarget extends AutoTestMediaPayload {
  resolvedPath: string | null;
}

function buildAutoTestMediaPayload(row: AutoTestMediaRow): AutoTestMediaPayload {
  const resolvedPath = row.original_file_path ? resolveUploadsPath(row.original_file_path) : null;
  const existsOnDisk = !!(resolvedPath && fs.existsSync(resolvedPath));

  return {
    compositeHash: row.composite_hash,
    fileName: row.original_file_path ? path.basename(row.original_file_path) : null,
    originalFilePath: row.original_file_path,
    mimeType: row.file_mime_type,
    fileType: row.file_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    existsOnDisk,
    thumbnailUrl: `/api/images/${row.composite_hash}/thumbnail`,
    imageUrl: `/api/images/${row.composite_hash}/file`,
  };
}

function findAutoTestMediaByHash(imageId: string): AutoTestMediaRow | undefined {
  return db.prepare(`
    SELECT
      mm.composite_hash,
      mm.thumbnail_path,
      mm.width,
      mm.height,
      if_.original_file_path,
      if_.mime_type as file_mime_type,
      if_.file_type,
      if_.file_size
    FROM media_metadata mm
    LEFT JOIN image_files if_ ON mm.composite_hash = if_.composite_hash AND if_.file_status = 'active'
    WHERE mm.composite_hash = ?
    LIMIT 1
  `).get(imageId) as AutoTestMediaRow | undefined;
}

function findRandomAutoTestMediaRow(): AutoTestMediaRow | undefined {
  const candidates = db.prepare(`
    SELECT
      mm.composite_hash,
      mm.thumbnail_path,
      mm.width,
      mm.height,
      if_.original_file_path,
      if_.mime_type as file_mime_type,
      if_.file_type,
      if_.file_size
    FROM media_metadata mm
    LEFT JOIN image_files if_ ON mm.composite_hash = if_.composite_hash AND if_.file_status = 'active'
    WHERE if_.original_file_path IS NOT NULL
    ORDER BY RANDOM()
    LIMIT 24
  `).all() as AutoTestMediaRow[];

  let fallback: AutoTestMediaRow | undefined;

  for (const candidate of candidates) {
    if (!fallback) {
      fallback = candidate;
    }

    const resolvedPath = candidate.original_file_path ? resolveUploadsPath(candidate.original_file_path) : null;
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      return candidate;
    }
  }

  return fallback;
}

class AutoTestMediaService {
  getPayloadByHash(imageId: string): AutoTestMediaPayload | null {
    const row = findAutoTestMediaByHash(imageId);
    if (!row || !row.original_file_path) {
      return null;
    }

    return buildAutoTestMediaPayload(row);
  }

  getRandomPayload(): AutoTestMediaPayload | null {
    const row = findRandomAutoTestMediaRow();
    return row ? buildAutoTestMediaPayload(row) : null;
  }

  resolveFileTarget(imageId: string): AutoTestMediaFileTarget | null {
    const row = findAutoTestMediaByHash(imageId);
    if (!row || !row.original_file_path) {
      return null;
    }

    const payload = buildAutoTestMediaPayload(row);
    return {
      ...payload,
      resolvedPath: row.original_file_path ? resolveUploadsPath(row.original_file_path) : null,
    };
  }
}

export const autoTestMediaService = new AutoTestMediaService();
