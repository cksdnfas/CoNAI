import { db } from '../../database/init';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import type { ColorHistogram } from '../../types/similarity';

/** What callers may hand over as a colour histogram: the object, its encoded BLOB, or legacy JSON text. */
export type ColorHistogramInput = ColorHistogram | Buffer | string | null | undefined;

function toBlob(histogram: ColorHistogramInput): Buffer | null {
  if (histogram === null || histogram === undefined) return null;
  if (Buffer.isBuffer(histogram)) return histogram;
  const value = typeof histogram === 'string' ? ImageSimilarityService.deserializeHistogram(histogram) : histogram;
  return ImageSimilarityService.serializeHistogram(value);
}

/**
 * Image-similarity features kept out of the wide media_metadata row (migration 041): one compact colour histogram
 * per media row, removed with it by FK cascade.
 */
export class MediaImageFeaturesModel {
  /** `LEFT JOIN` fragment exposing the histogram as `<featuresAlias>.color_histogram` next to media alias `mediaAlias`. */
  static join(mediaAlias: string, featuresAlias = 'mf'): string {
    return `LEFT JOIN media_image_features ${featuresAlias} ON ${featuresAlias}.media_id = ${mediaAlias}.media_id`;
  }

  /** Store or replace one media row's histogram; null/undefined removes it. No-op when the hash has no row. */
  static setHistogram(compositeHash: string, histogram: ColorHistogramInput): void {
    const blob = toBlob(histogram);
    if (!blob) {
      db.prepare(`
        DELETE FROM media_image_features
        WHERE media_id = (SELECT media_id FROM media_metadata WHERE composite_hash = ?)
      `).run(compositeHash);
      return;
    }

    db.prepare(`
      INSERT INTO media_image_features (media_id, color_histogram)
      SELECT media_id, ? FROM media_metadata WHERE composite_hash = ?
      ON CONFLICT(media_id) DO UPDATE SET color_histogram = excluded.color_histogram
    `).run(blob, compositeHash);
  }

  static getHistogram(compositeHash: string): Buffer | null {
    const row = db.prepare(`
      SELECT mf.color_histogram
      FROM media_metadata mm
      JOIN media_image_features mf ON mf.media_id = mm.media_id
      WHERE mm.composite_hash = ?
    `).get(compositeHash) as { color_histogram: Buffer } | undefined;
    return row?.color_histogram ?? null;
  }
}
