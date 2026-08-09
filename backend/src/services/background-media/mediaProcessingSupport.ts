import path from 'path';
import { db } from '../../database/init';
import type { FileType } from '../../types/image';

export interface ExistingMediaMetadataSummary {
  composite_hash: string;
  ai_tool: string | null;
  model_name: string | null;
  lora_models: string | null;
  model_references: string | null;
  steps: number | null;
  cfg_scale: number | null;
  sampler: string | null;
  seed: number | null;
  scheduler: string | null;
  prompt: string | null;
  negative_prompt: string | null;
  character_prompt_text: string | null;
  raw_nai_parameters: string | null;
}

function hasMeaningfulMetadataValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 && normalized.toLowerCase() !== 'unknown';
  }
  return true;
}

export function shouldBackfillDuplicateMetadata(existing: ExistingMediaMetadataSummary): boolean {
  return ![
    existing.ai_tool,
    existing.model_name,
    existing.lora_models,
    existing.model_references,
    existing.steps,
    existing.cfg_scale,
    existing.sampler,
    existing.seed,
    existing.scheduler,
    existing.prompt,
    existing.negative_prompt,
    existing.character_prompt_text,
    existing.raw_nai_parameters,
  ].some(hasMeaningfulMetadataValue);
}

export function findExistingMediaMetadataSummary(
  compositeHash: string,
): ExistingMediaMetadataSummary | undefined {
  return db.prepare(`
    SELECT
      composite_hash, ai_tool, model_name, lora_models, model_references,
      steps, cfg_scale, sampler, seed, scheduler,
      prompt, negative_prompt, character_prompt_text, raw_nai_parameters
    FROM media_metadata
    WHERE composite_hash = ?
  `).get(compositeHash) as ExistingMediaMetadataSummary | undefined;
}

export function linkMediaFileToHash(fileId: number, compositeHash: string): void {
  db.prepare('UPDATE image_files SET composite_hash = ? WHERE id = ?').run(compositeHash, fileId);
}

export function markFileAsProcessingFailed(fileId: number, filePath: string, reason: string): void {
  db.prepare(`
    UPDATE image_files
    SET file_status = 'failed',
        last_verified_date = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(fileId);

  console.warn(`  ⚠️  Media file skipped and marked failed: ${path.basename(filePath)} (${reason})`);
}

export function isUnsupportedImageFormatError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unsupported image format|input file is missing|empty input file/i.test(message);
}

export function determineMediaFileType(mimeType: string, filePath: string): FileType {
  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gif' || ext === '.apng') {
    return 'animated';
  }

  return 'image';
}
