import crypto from 'crypto';
import { db } from '../database/init';
import { ImageMetadataRecord, ImageWithFileView } from '../types/image';
import {
  PromptSimilarityAlgorithm,
  PromptSimilarityFieldScore,
  PromptSimilarityMatch,
  PromptSimilarityRebuildResult,
  PromptSimilaritySettings,
} from '../types/promptSimilarity';
import { settingsService } from './settingsService';

const PROMPT_SIMILARITY_VERSION = 1;
const MINHASH_SIGNATURE_SIZE = 16;
const SIMHASH_HEX_LENGTH = 16;
const MINHASH_HEX_CHUNK_LENGTH = 8;

type PromptSimilarityFieldName = 'positive' | 'negative' | 'auto';

interface PromptSimilaritySourceTexts {
  positive: string | null;
  negative: string | null;
  auto: string | null;
}

interface PromptSimilarityStoredFields {
  prompt_similarity_algorithm: PromptSimilarityAlgorithm | null;
  prompt_similarity_version: number | null;
  pos_prompt_normalized: string | null;
  neg_prompt_normalized: string | null;
  auto_prompt_normalized: string | null;
  pos_prompt_fingerprint: string | null;
  neg_prompt_fingerprint: string | null;
  auto_prompt_fingerprint: string | null;
  prompt_similarity_updated_date: string | null;
}

interface PromptSimilarityPreparedFields extends PromptSimilarityStoredFields {}

interface PromptSimilarityPreparedTexts {
  positiveNormalized: string | null;
  negativeNormalized: string | null;
  autoNormalized: string | null;
  positiveFingerprint: string | null;
  negativeFingerprint: string | null;
  autoFingerprint: string | null;
}

type PromptSimilarityCandidateRow = ImageWithFileView & PromptSimilarityStoredFields;

function hashToHex(input: string, length: number): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, length);
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeThreshold(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Math.max(0, Math.min(1, roundScore(fallback)));
  }

  return Math.max(0, Math.min(1, roundScore(value)));
}

export class PromptSimilarityService {
  /** Build normalized prompt texts from metadata fields. */
  static buildSourceTexts(data: Pick<ImageMetadataRecord, 'prompt' | 'negative_prompt' | 'auto_tags'>): PromptSimilaritySourceTexts {
    return {
      positive: this.normalizePromptText(data.prompt),
      negative: this.normalizePromptText(data.negative_prompt),
      auto: this.normalizePromptText(this.extractAutoPromptText(data.auto_tags)),
    };
  }

  /** Normalize comma-delimited prompt text into a canonical string. */
  static normalizePromptText(text: string | null | undefined): string | null {
    if (typeof text !== 'string') {
      return null;
    }

    const tags = text
      .replace(/\r?\n+/g, ',')
      .replace(/[;|]+/g, ',')
      .split(',')
      .map((item) => this.normalizePromptTag(item))
      .filter((item): item is string => Boolean(item));

    return tags.length > 0 ? tags.join(', ') : null;
  }

  /** Normalize one comma-delimited tag. */
  static normalizePromptTag(tag: string | null | undefined): string | null {
    if (typeof tag !== 'string') {
      return null;
    }

    const normalized = tag
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    return normalized.length > 0 ? normalized : null;
  }

  /** Extract auto prompt text from the stored auto_tags payload. */
  static extractAutoPromptText(autoTags: string | null | undefined): string | null {
    if (typeof autoTags !== 'string' || autoTags.trim().length === 0) {
      return null;
    }

    try {
      const parsed = JSON.parse(autoTags) as {
        tagger?: {
          caption?: string | null;
          taglist?: string | null;
        } | null;
      };

      return parsed?.tagger?.caption || parsed?.tagger?.taglist || null;
    } catch {
      return null;
    }
  }

  /** Build prompt similarity metadata fields for one media record. */
  static buildPreparedFields(
    data: Pick<ImageMetadataRecord, 'prompt' | 'negative_prompt' | 'auto_tags'>,
    algorithm: PromptSimilarityAlgorithm,
  ): PromptSimilarityPreparedFields {
    const sourceTexts = this.buildSourceTexts(data);

    return {
      prompt_similarity_algorithm: algorithm,
      prompt_similarity_version: PROMPT_SIMILARITY_VERSION,
      pos_prompt_normalized: sourceTexts.positive,
      neg_prompt_normalized: sourceTexts.negative,
      auto_prompt_normalized: sourceTexts.auto,
      pos_prompt_fingerprint: this.buildFingerprint(sourceTexts.positive, algorithm),
      neg_prompt_fingerprint: this.buildFingerprint(sourceTexts.negative, algorithm),
      auto_prompt_fingerprint: this.buildFingerprint(sourceTexts.auto, algorithm),
      prompt_similarity_updated_date: new Date().toISOString(),
    };
  }

  /** Search prompt-similar images for one source composite hash. */
  static findSimilarByCompositeHash(compositeHash: string, limitOverride?: number): PromptSimilarityMatch[] {
    const settings = this.getEffectiveSettings();
    if (!settings.enabled) {
      return [];
    }
    const source = db.prepare(`
      SELECT *
      FROM media_metadata
      WHERE composite_hash = ?
    `).get(compositeHash) as (ImageMetadataRecord & PromptSimilarityStoredFields) | undefined;

    if (!source) {
      throw new Error('Image metadata not found');
    }

    const sourcePrepared = this.getPreparedTexts(source, settings.algorithm);
    const activeFields = this.getActiveFields(sourcePrepared, settings);
    if (activeFields.length === 0) {
      return [];
    }

    const rows = db.prepare(`
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.file_type,
        if.mime_type,
        if.file_size,
        if.folder_id,
        wf.folder_name
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      LEFT JOIN watched_folders wf ON if.folder_id = wf.id
      WHERE im.composite_hash != ?
      GROUP BY im.composite_hash
    `).all(compositeHash) as PromptSimilarityCandidateRow[];

    const matches: PromptSimilarityMatch[] = [];
    for (const row of rows) {
      const targetPrepared = this.getPreparedTexts(row, settings.algorithm);
      const positive = this.calculateFieldScore(sourcePrepared.positiveNormalized, targetPrepared.positiveNormalized, sourcePrepared.positiveFingerprint, targetPrepared.positiveFingerprint, settings.algorithm, settings.fieldThresholds.positive);
      const negative = this.calculateFieldScore(sourcePrepared.negativeNormalized, targetPrepared.negativeNormalized, sourcePrepared.negativeFingerprint, targetPrepared.negativeFingerprint, settings.algorithm, settings.fieldThresholds.negative);
      const auto = this.calculateFieldScore(sourcePrepared.autoNormalized, targetPrepared.autoNormalized, sourcePrepared.autoFingerprint, targetPrepared.autoFingerprint, settings.algorithm, settings.fieldThresholds.auto);

      const fieldScores = { positive, negative, auto };
      if (!activeFields.every((fieldName) => fieldScores[fieldName].passed)) {
        continue;
      }

      const combinedSimilarity = this.calculateCombinedSimilarity(fieldScores, settings, activeFields);
      if (combinedSimilarity < settings.combinedThreshold) {
        continue;
      }

      matches.push({
        image: row,
        combinedSimilarity,
        positive,
        negative,
        auto,
      });
    }

    matches.sort((left, right) => right.combinedSimilarity - left.combinedSimilarity);

    const resultLimit = typeof limitOverride === 'number' && Number.isFinite(limitOverride)
      ? Math.max(1, Math.min(100, Math.round(limitOverride)))
      : settings.resultLimit;

    return matches.slice(0, resultLimit);
  }

  /** Rebuild prompt similarity fields for all rows using the active algorithm. */
  static rebuildAll(): PromptSimilarityRebuildResult {
    const settings = this.getEffectiveSettings();
    const rows = db.prepare(`
      SELECT composite_hash, prompt, negative_prompt, auto_tags
      FROM media_metadata
    `).all() as Array<Pick<ImageMetadataRecord, 'composite_hash' | 'prompt' | 'negative_prompt' | 'auto_tags'>>;

    const updateStatement = db.prepare(`
      UPDATE media_metadata
      SET
        prompt_similarity_algorithm = ?,
        prompt_similarity_version = ?,
        pos_prompt_normalized = ?,
        neg_prompt_normalized = ?,
        auto_prompt_normalized = ?,
        pos_prompt_fingerprint = ?,
        neg_prompt_fingerprint = ?,
        auto_prompt_fingerprint = ?,
        prompt_similarity_updated_date = ?
      WHERE composite_hash = ?
    `);

    const runTransaction = db.transaction((records: typeof rows) => {
      let updated = 0;
      let skipped = 0;

      for (const record of records) {
        const fields = this.buildPreparedFields(record, settings.algorithm);
        const hasAnyValue = Boolean(fields.pos_prompt_normalized || fields.neg_prompt_normalized || fields.auto_prompt_normalized);
        if (!hasAnyValue) {
          skipped += 1;
        }

        updateStatement.run(
          fields.prompt_similarity_algorithm,
          fields.prompt_similarity_version,
          fields.pos_prompt_normalized,
          fields.neg_prompt_normalized,
          fields.auto_prompt_normalized,
          fields.pos_prompt_fingerprint,
          fields.neg_prompt_fingerprint,
          fields.auto_prompt_fingerprint,
          fields.prompt_similarity_updated_date,
          record.composite_hash,
        );
        updated += 1;
      }

      return { updated, skipped };
    });

    const result = runTransaction(rows);
    return {
      algorithm: settings.algorithm,
      processed: rows.length,
      updated: result.updated,
      skipped: result.skipped,
    };
  }

  /** Return the effective prompt similarity settings with sanitized values. */
  static getEffectiveSettings(): PromptSimilaritySettings {
    const defaults = settingsService.getDefaultSettings().similarity.promptSimilarity;
    const current = settingsService.loadSettings().similarity.promptSimilarity;

    return {
      enabled: current.enabled,
      algorithm: current.algorithm,
      autoBuildOnMetadataUpdate: current.autoBuildOnMetadataUpdate,
      resultLimit: Math.max(1, Math.min(12, Math.round(current.resultLimit))),
      combinedThreshold: normalizeThreshold(current.combinedThreshold, defaults.combinedThreshold),
      weights: {
        positive: normalizeWeight(current.weights.positive, defaults.weights.positive),
        negative: normalizeWeight(current.weights.negative, defaults.weights.negative),
        auto: normalizeWeight(current.weights.auto, defaults.weights.auto),
      },
      fieldThresholds: {
        positive: normalizeThreshold(current.fieldThresholds.positive, defaults.fieldThresholds.positive),
        negative: normalizeThreshold(current.fieldThresholds.negative, defaults.fieldThresholds.negative),
        auto: normalizeThreshold(current.fieldThresholds.auto, defaults.fieldThresholds.auto),
      },
    };
  }

  /** Build a fingerprint string for one normalized prompt. */
  static buildFingerprint(normalized: string | null, algorithm: PromptSimilarityAlgorithm): string | null {
    if (!normalized) {
      return null;
    }

    const features = this.buildFeatureTokens(normalized);
    if (features.length === 0) {
      return null;
    }

    if (algorithm === 'minhash') {
      return this.buildMinHashFingerprint(features);
    }

    return this.buildSimHashFingerprint(features);
  }

  /** Calculate one field similarity score. */
  private static calculateFieldScore(
    sourceNormalized: string | null,
    targetNormalized: string | null,
    sourceFingerprint: string | null,
    targetFingerprint: string | null,
    algorithm: PromptSimilarityAlgorithm,
    threshold: number,
  ): PromptSimilarityFieldScore {
    const hasSource = Boolean(sourceNormalized);
    const hasTarget = Boolean(targetNormalized);
    const exact = Boolean(sourceNormalized && targetNormalized && sourceNormalized === targetNormalized);

    if (!hasSource) {
      return {
        similarity: 0,
        threshold,
        passed: true,
        exact: false,
        hasSource,
        hasTarget,
      };
    }

    const similarity = this.calculateFingerprintSimilarity(sourceNormalized, targetNormalized, sourceFingerprint, targetFingerprint, algorithm);
    return {
      similarity,
      threshold,
      passed: similarity >= threshold,
      exact,
      hasSource,
      hasTarget,
    };
  }

  /** Calculate the weighted combined similarity score. */
  private static calculateCombinedSimilarity(
    fieldScores: Record<PromptSimilarityFieldName, PromptSimilarityFieldScore>,
    settings: PromptSimilaritySettings,
    activeFields: PromptSimilarityFieldName[],
  ): number {
    let totalWeight = 0;
    let weightedScore = 0;

    for (const fieldName of activeFields) {
      const weight = settings.weights[fieldName];
      totalWeight += weight;
      weightedScore += fieldScores[fieldName].similarity * weight;
    }

    if (totalWeight <= 0) {
      return 0;
    }

    return roundScore(weightedScore / totalWeight);
  }

  /** Resolve active weighted fields from the source payload. */
  private static getActiveFields(
    source: PromptSimilarityPreparedTexts,
    settings: PromptSimilaritySettings,
  ): PromptSimilarityFieldName[] {
    const fields: Array<{ name: PromptSimilarityFieldName; hasSource: boolean; weight: number }> = [
      { name: 'positive', hasSource: Boolean(source.positiveNormalized), weight: settings.weights.positive },
      { name: 'negative', hasSource: Boolean(source.negativeNormalized), weight: settings.weights.negative },
      { name: 'auto', hasSource: Boolean(source.autoNormalized), weight: settings.weights.auto },
    ];

    return fields.filter((field) => field.hasSource && field.weight > 0).map((field) => field.name);
  }

  /** Build normalized text and fingerprint pairs for one row. */
  private static getPreparedTexts(
    record: Pick<ImageMetadataRecord, 'prompt' | 'negative_prompt' | 'auto_tags'> & Partial<PromptSimilarityStoredFields>,
    algorithm: PromptSimilarityAlgorithm,
  ): PromptSimilarityPreparedTexts {
    const sourceTexts = this.buildSourceTexts(record);
    const canReuseStoredFields = record.prompt_similarity_algorithm === algorithm && record.prompt_similarity_version === PROMPT_SIMILARITY_VERSION;

    return {
      positiveNormalized: record.pos_prompt_normalized ?? sourceTexts.positive,
      negativeNormalized: record.neg_prompt_normalized ?? sourceTexts.negative,
      autoNormalized: record.auto_prompt_normalized ?? sourceTexts.auto,
      positiveFingerprint: canReuseStoredFields ? (record.pos_prompt_fingerprint ?? this.buildFingerprint(record.pos_prompt_normalized ?? sourceTexts.positive, algorithm)) : this.buildFingerprint(record.pos_prompt_normalized ?? sourceTexts.positive, algorithm),
      negativeFingerprint: canReuseStoredFields ? (record.neg_prompt_fingerprint ?? this.buildFingerprint(record.neg_prompt_normalized ?? sourceTexts.negative, algorithm)) : this.buildFingerprint(record.neg_prompt_normalized ?? sourceTexts.negative, algorithm),
      autoFingerprint: canReuseStoredFields ? (record.auto_prompt_fingerprint ?? this.buildFingerprint(record.auto_prompt_normalized ?? sourceTexts.auto, algorithm)) : this.buildFingerprint(record.auto_prompt_normalized ?? sourceTexts.auto, algorithm),
    };
  }

  /** Convert normalized text into feature tokens. */
  private static buildFeatureTokens(normalized: string): string[] {
    const tags = normalized.split(',').map((item) => item.trim()).filter(Boolean);
    if (tags.length === 0) {
      return [];
    }

    const features: string[] = [...tags.map((tag) => `tag:${tag}`)];
    for (let index = 0; index < tags.length - 1; index += 1) {
      features.push(`pair:${tags[index]}__${tags[index + 1]}`);
    }

    return features;
  }

  /** Build a 64-bit SimHash fingerprint encoded as hex text. */
  private static buildSimHashFingerprint(features: string[]): string {
    const bitWeights = new Array<number>(64).fill(0);

    for (const feature of features) {
      const featureHash = BigInt(`0x${hashToHex(feature, SIMHASH_HEX_LENGTH)}`);
      for (let bitIndex = 0; bitIndex < 64; bitIndex += 1) {
        const mask = 1n << BigInt(bitIndex);
        bitWeights[bitIndex] += (featureHash & mask) === 0n ? -1 : 1;
      }
    }

    let fingerprint = 0n;
    for (let bitIndex = 0; bitIndex < 64; bitIndex += 1) {
      if (bitWeights[bitIndex] >= 0) {
        fingerprint |= 1n << BigInt(bitIndex);
      }
    }

    return fingerprint.toString(16).padStart(SIMHASH_HEX_LENGTH, '0');
  }

  /** Build a compact MinHash signature encoded as hex text. */
  private static buildMinHashFingerprint(features: string[]): string {
    const uniqueFeatures = [...new Set(features)];
    const chunks: string[] = [];

    for (let index = 0; index < MINHASH_SIGNATURE_SIZE; index += 1) {
      let minValue = Number.MAX_SAFE_INTEGER;

      for (const feature of uniqueFeatures) {
        const value = Number.parseInt(hashToHex(`minhash:${index}:${feature}`, MINHASH_HEX_CHUNK_LENGTH), 16);
        if (value < minValue) {
          minValue = value;
        }
      }

      chunks.push(minValue.toString(16).padStart(MINHASH_HEX_CHUNK_LENGTH, '0'));
    }

    return chunks.join('');
  }

  /** Calculate similarity between two prompt fingerprints. */
  private static calculateFingerprintSimilarity(
    sourceNormalized: string | null,
    targetNormalized: string | null,
    sourceFingerprint: string | null,
    targetFingerprint: string | null,
    algorithm: PromptSimilarityAlgorithm,
  ): number {
    if (!sourceNormalized || !targetNormalized) {
      return 0;
    }

    if (sourceNormalized === targetNormalized) {
      return 100;
    }

    if (!sourceFingerprint || !targetFingerprint) {
      return 0;
    }

    if (algorithm === 'minhash') {
      return this.calculateMinHashSimilarity(sourceFingerprint, targetFingerprint);
    }

    return this.calculateSimHashSimilarity(sourceFingerprint, targetFingerprint);
  }

  /** Calculate SimHash similarity as a percentage. */
  private static calculateSimHashSimilarity(sourceFingerprint: string, targetFingerprint: string): number {
    const left = BigInt(`0x${sourceFingerprint}`);
    const right = BigInt(`0x${targetFingerprint}`);
    let xor = left ^ right;
    let distance = 0;

    while (xor > 0n) {
      xor &= xor - 1n;
      distance += 1;
    }

    return clampPercentage(((64 - distance) / 64) * 100);
  }

  /** Calculate MinHash similarity as a percentage. */
  private static calculateMinHashSimilarity(sourceFingerprint: string, targetFingerprint: string): number {
    const maxLength = Math.min(sourceFingerprint.length, targetFingerprint.length);
    const chunkCount = Math.floor(maxLength / MINHASH_HEX_CHUNK_LENGTH);
    if (chunkCount === 0) {
      return 0;
    }

    let matches = 0;
    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * MINHASH_HEX_CHUNK_LENGTH;
      const end = start + MINHASH_HEX_CHUNK_LENGTH;
      if (sourceFingerprint.slice(start, end) === targetFingerprint.slice(start, end)) {
        matches += 1;
      }
    }

    return clampPercentage((matches / chunkCount) * 100);
  }
}
