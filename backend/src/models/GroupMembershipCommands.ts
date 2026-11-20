import { db } from '../database/init';
import { chunkArray, pageBoundary, placeholders } from '../services/maintenance/libraryBatch';

export interface GroupBulkAddCounts {
  addedCount: number;
  convertedCount: number;
  skippedCount: number;
  errors: string[];
}

export interface GroupBulkRemoveCounts {
  removedCount: number;
  skippedCount: number;
  errors: string[];
}

export class GroupNotFoundError extends Error {
  constructor(id: number) { super(`Group ${id} not found`); }
}

function requireGroup(id: number) {
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(id)) throw new GroupNotFoundError(id);
}

type Counts = { added: number; converted: number; skipped: number };

/** All callers share the manual/auto transition; atomic assignments and paged batches have different failure contracts. */
function manualPageWriter(groupId: number) {
  const insert = db.prepare("INSERT INTO image_groups (group_id, composite_hash, order_index, collection_type) VALUES (?, ?, 0, 'manual')");
  const convert = db.prepare("UPDATE image_groups SET collection_type = 'manual' WHERE group_id = ? AND composite_hash = ? AND collection_type = 'auto'");
  return (hashes: string[], counts: Counts, onMissing: (hash: string) => void, onError?: (hash: string, error: unknown) => void) => {
    const rows = db.prepare(`SELECT m.composite_hash, ig.collection_type FROM media_metadata m
      LEFT JOIN image_groups ig ON ig.group_id = ? AND ig.composite_hash = m.composite_hash
      WHERE m.composite_hash IN (${placeholders(hashes.length)})`).all(groupId, ...hashes) as Array<{ composite_hash: string; collection_type: string | null }>;
    const members = new Map(rows.map(row => [row.composite_hash, row.collection_type]));
    for (const hash of hashes) {
      const previous = members.get(hash);
      if (previous === undefined) { onMissing(hash); continue; }
      if (previous === 'manual') { counts.skipped++; continue; }
      try {
        if (previous === 'auto') {
          convert.run(groupId, hash);
          counts.converted++;
        } else {
          insert.run(groupId, hash);
          counts.added++;
        }
        members.set(hash, 'manual');
      } catch (error) {
        if (!onError) throw error;
        onError(hash, error);
      }
    }
  };
}

export function addImagesToGroupManually(groupId: number, hashes: string[]) {
  return db.transaction(() => {
    requireGroup(groupId);
    const write = manualPageWriter(groupId);
    const counts = { added: 0, converted: 0, skipped: 0 };
    const missing_hashes: string[] = [];
    for (const page of chunkArray([...new Set(hashes)])) {
      write(page, counts, hash => { missing_hashes.push(hash); counts.skipped++; });
    }
    return { ...counts, missing_hashes };
  }).immediate();
}

export async function addImagesManuallyInPages(groupId: number, hashes: string[]): Promise<GroupBulkAddCounts> {
  const counts = { added: 0, converted: 0, skipped: 0 };
  const errors: string[] = [];
  const write = manualPageWriter(groupId);
  const apply = db.transaction((page: string[]) => {
    requireGroup(groupId);
    write(page, counts, hash => errors.push(`Image ${hash}: Image not found`),
      (hash, error) => errors.push(`Image ${hash}: ${(error as Error).message}`));
  });
  for (const page of chunkArray(hashes)) {
    apply.immediate(page);
    await pageBoundary({});
  }
  return { addedCount: counts.added, convertedCount: counts.converted, skippedCount: counts.skipped, errors };
}

export async function removeImagesInPages(groupId: number, hashes: string[]): Promise<GroupBulkRemoveCounts> {
  const remove = db.prepare('DELETE FROM image_groups WHERE group_id = ? AND composite_hash = ?');
  const counts: GroupBulkRemoveCounts = { removedCount: 0, skippedCount: 0, errors: [] };
  const apply = db.transaction((page: string[]) => {
    requireGroup(groupId);
    for (const hash of page) {
      try {
        if (remove.run(groupId, hash).changes) counts.removedCount++;
        else counts.skippedCount++;
      } catch (error) {
        counts.errors.push(`Image ${hash}: ${(error as Error).message}`);
      }
    }
  });
  for (const page of chunkArray(hashes)) {
    apply.immediate(page);
    await pageBoundary({});
  }
  return counts;
}
