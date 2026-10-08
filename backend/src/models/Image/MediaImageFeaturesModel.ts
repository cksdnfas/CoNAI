import { db } from '../../database/init';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import type { ColorHistogram } from '../../types/similarity';

/** What callers may hand over as a colour histogram: the object, its encoded BLOB, or legacy JSON text. */
export type ColorHistogramInput = ColorHistogram | Buffer | string | null | undefined;

function toHistogram(histogram: Exclude<ColorHistogramInput, null | undefined>): ColorHistogram {
  return typeof histogram === 'string' || Buffer.isBuffer(histogram)
    ? ImageSimilarityService.deserializeHistogram(histogram)
    : histogram;
}

/** The eight descriptor columns of media_similarity_index, or null when any value is not a finite number. */
export function colorDescriptorColumns(histogram: ColorHistogram): number[] | null {
  try {
    const descriptor = ImageSimilarityService.colorDescriptor(histogram);
    const values = [
      ...descriptor.averageRgb.slice(0, 3),
      ...descriptor.dominantRgb.slice(0, 3),
      descriptor.luminance,
      descriptor.saturation,
    ];
    return values.length === 8 && values.every((value) => typeof value === 'number' && Number.isFinite(value)) ? values : null;
  } catch {
    return null;
  }
}

/**
 * Image-similarity features kept out of the wide media_metadata row (migration 041): one compact colour histogram
 * per media row, removed with it by FK cascade. Its colour descriptor is mirrored into media_similarity_index
 * (migration 042) so the colour search can filter in SQL.
 */
export class MediaImageFeaturesModel {
  /** `LEFT JOIN` fragment exposing the histogram as `<featuresAlias>.color_histogram` next to media alias `mediaAlias`. */
  static join(mediaAlias: string, featuresAlias = 'mf'): string {
    return `LEFT JOIN media_image_features ${featuresAlias} ON ${featuresAlias}.media_id = ${mediaAlias}.media_id`;
  }

  /** Store or replace one media row's histogram; null/undefined removes it. No-op when the hash has no row. */
  static setHistogram(compositeHash: string, histogram: ColorHistogramInput): void {
    const object = histogram === null || histogram === undefined ? null : toHistogram(histogram);
    const blob = object ? (Buffer.isBuffer(histogram) ? histogram : ImageSimilarityService.serializeHistogram(object)) : null;
    const descriptor = object ? colorDescriptorColumns(object) : null;

    db.transaction(() => {
      if (!blob) {
        db.prepare(`
          DELETE FROM media_image_features
          WHERE media_id = (SELECT media_id FROM media_metadata WHERE composite_hash = ?)
        `).run(compositeHash);
      } else {
        db.prepare(`
          INSERT INTO media_image_features (media_id, color_histogram)
          SELECT media_id, ? FROM media_metadata WHERE composite_hash = ?
          ON CONFLICT(media_id) DO UPDATE SET color_histogram = excluded.color_histogram
        `).run(blob, compositeHash);
      }

      const values = descriptor ?? new Array<number | null>(8).fill(null);
      db.prepare(`
        UPDATE media_similarity_index
        SET avg_r = ?, avg_g = ?, avg_b = ?, dom_r = ?, dom_g = ?, dom_b = ?, luminance = ?, saturation = ?
        WHERE media_id = (SELECT media_id FROM media_metadata WHERE composite_hash = ?)
      `).run(...values, compositeHash);
    })();
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
