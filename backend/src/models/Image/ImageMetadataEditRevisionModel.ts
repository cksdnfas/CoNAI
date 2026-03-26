import { db } from '../../database/init';

export interface ImageMetadataEditRevisionRecord {
  id: number;
  composite_hash: string;
  image_file_id: number | null;
  previous_file_path: string;
  replacement_file_path: string;
  recycle_bin_path: string;
  previous_metadata_json: string | null;
  next_metadata_json: string | null;
  created_date: string;
  restored_date: string | null;
}

export class ImageMetadataEditRevisionModel {
  static create(data: Omit<ImageMetadataEditRevisionRecord, 'id' | 'created_date' | 'restored_date'>): number {
    const info = db.prepare(`
      INSERT INTO image_metadata_edit_revisions (
        composite_hash,
        image_file_id,
        previous_file_path,
        replacement_file_path,
        recycle_bin_path,
        previous_metadata_json,
        next_metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.composite_hash,
      data.image_file_id,
      data.previous_file_path,
      data.replacement_file_path,
      data.recycle_bin_path,
      data.previous_metadata_json,
      data.next_metadata_json,
    );

    return info.lastInsertRowid as number;
  }

  static findLatestByHash(compositeHash: string): ImageMetadataEditRevisionRecord | null {
    return db.prepare(`
      SELECT *
      FROM image_metadata_edit_revisions
      WHERE composite_hash = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(compositeHash) as ImageMetadataEditRevisionRecord | null;
  }
}
