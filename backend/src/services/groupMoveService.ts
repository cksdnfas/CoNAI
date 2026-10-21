import { createHash } from 'node:crypto';
import type { GroupMoveOptions, GroupMoveResult, GroupRecord } from '@conai/shared';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { EmoticonService, EMOTICON_KEYWORDS_PER_IMAGE } from './emoticonService';
import { GroupHierarchyService } from './groupHierarchyService';
import { GroupModel } from '../models/Group';

/** Kept separate from the mutation service to avoid starting auto-collect jobs during planning. */
export class GroupMoveError extends Error {}

/**
 * Preview runs the exact mutation inside a rolled-back write transaction. The digest covers the rows read,
 * including memberships and linked resources, not second-resolution updated_date values.
 */
export function executeGroupMove(ids: number[], parentId: number | null, options: GroupMoveOptions = {}): GroupMoveResult {
  // user settings already attaches the image database. One connection locks both databases; only the image
  // database is written, so references can be checked without a cross-connection lock or partial commit.
  const db = getUserSettingsDb();
  const previewMarker = {};
  let result!: GroupMoveResult;
  try {
    db.transaction(() => {
      const hierarchy = new GroupHierarchyService(db);
      const selected = new Set(ids);
      const digest = createHash('sha256');
      const record = (value: unknown) => digest.update(JSON.stringify(value)).update('\n');
      record([ids, parentId, options.edit]);
      const snapshots = new Map<number, GroupRecord>();
      const conflicts: GroupMoveResult['conflicts'] = [];
      const merged: Record<number, number> = {};
      let visited = 0;
      const snapshot = (id: number) => {
        const existing = snapshots.get(id);
        if (existing) return existing;
        const group = db.prepare('SELECT * FROM groups WHERE id=?').get(id) as GroupRecord | undefined;
        if (!group) throw new GroupMoveError(`Group ${id} not found`);
        snapshots.set(id, group);
        record(group);
        return group;
      };
      const contents = new Set<number>();
      const entryCache = new Map<number, ReturnType<typeof EmoticonService.listEntries>>();
      const entries = (id: number) => {
        let rows = entryCache.get(id);
        if (!rows) { rows = EmoticonService.listEntries(id, db); entryCache.set(id, rows); }
        return rows;
      };
      const snapshotContents = (id: number) => {
        if (contents.has(id)) return;
        contents.add(id);
        for (const row of db.prepare('SELECT * FROM image_groups WHERE group_id=? ORDER BY composite_hash').iterate(id)) record(row);
        for (const row of db.prepare('SELECT * FROM group_resources WHERE group_id=? ORDER BY resource_key').iterate(id)) record(row);
      };
      for (const id of ids) {
        snapshot(id);
        const validation = hierarchy.validateHierarchy(id, parentId);
        if (!validation.valid) throw new GroupMoveError(validation.error);
      }
      // A selected descendant travels with its selected ancestor, never as an additional independent move.
      const roots = ids.filter(id => !hierarchy.getAncestorPath(id).some(a => a.id !== id && selected.has(a.id)));
      if (options.edit) GroupModel.update(ids[0], options.edit, db);
      const move = (id: number, parent: number | null) => {
        if (++visited > 500) throw new GroupMoveError('Move exceeds 500 affected groups; split the operation');
        snapshot(id);
        const source = db.prepare('SELECT * FROM groups WHERE id=?').get(id) as GroupRecord;
        const siblings = db.prepare('SELECT id,name FROM groups WHERE parent_id IS ? ORDER BY id LIMIT 501').all(parent);
        record(siblings);
        const destination = db.prepare('SELECT id FROM groups WHERE parent_id IS ? AND name=? COLLATE NOCASE AND id<>?')
          .get(parent, source.name, id) as { id: number } | undefined;
        if (!destination) {
          const validation = hierarchy.validateHierarchy(id, parent);
          if (!validation.valid) throw new GroupMoveError(validation.error);
          db.prepare('UPDATE groups SET parent_id=?,updated_date=CURRENT_TIMESTAMP WHERE id=?').run(parent, id);
          return;
        }
        const target = snapshot(destination.id);
        if (!options.preview && !options.merge_token) throw new GroupMoveError('Same-name collision: preview and explicitly confirm a recursive merge first');
        if (hierarchy.getAncestorPath(target.id).some(a => a.id === id)) throw new GroupMoveError('Cannot merge into a descendant');
        if (hierarchy.getAncestorPath(id).some(a => a.id === target.id)) throw new GroupMoveError('Cannot merge into an ancestor; retain the source or rename it before moving');
        snapshotContents(id);
        snapshotContents(target.id);
        // These live in a different database. Reject rather than non-atomically retarget approved queued work or
        // character links (whose expression group also has a path-based identity).
        const settings = getUserSettingsDb();
        const queueReference = settings.prepare('SELECT id FROM generation_queue_jobs WHERE requested_group_id=? OR json_extract(request_payload, \'$.groupId\')=? LIMIT 1').get(id, id);
        const profileReference = settings.prepare(`SELECT p.id FROM llm_chat_profiles p, json_each(CASE WHEN json_valid(p.chat_style) THEN p.chat_style ELSE '{}' END, '$.emoticonGroupIds') j WHERE j.value=? LIMIT 1`).get(id);
        const historyReference = settings.prepare('SELECT id FROM api_generation_history WHERE assigned_group_id=? LIMIT 1').get(id);
        const jobReference = settings.prepare("SELECT job_id FROM runtime_jobs WHERE json_extract(params,'$.groupId')=? LIMIT 1").get(id);
        if (queueReference || profileReference || historyReference || jobReference) throw new GroupMoveError(`Group ${id} is referenced by generation history/queue (including completed records), a runtime job or a chat profile; retain it and rename it before moving instead of merging`);
        conflicts.push({ source_id: id, source_name: source.name, source_path: hierarchy.getAncestorPath(id).map(a => a.name).join('/'), destination_id: target.id, destination_name: target.name, destination_path: hierarchy.getAncestorPath(target.id).map(a => a.name).join('/') });
        const sourceEntries = entries(id);
        const destinationEntries = entries(target.id);
        const targets = new Map(destinationEntries.map(e => [e.compositeHash, e]));
        const keywords = new Map<string, string[]>();
        for (const entry of sourceEntries) {
          if (!entry.explicit) continue;
          if (!entry.keywords.length && targets.has(entry.compositeHash)) continue;
          const combined = new Map<string, string>();
          const existing = targets.get(entry.compositeHash);
          if (existing?.explicit && entry.keywords.every(word => existing.keywords.some(value => value.toLowerCase() === word.toLowerCase()))) continue;
          for (const word of [...(existing?.explicit ? existing.keywords : []), ...entry.keywords]) {
            if (!combined.has(word.toLowerCase())) combined.set(word.toLowerCase(), word);
          }
          keywords.set(entry.compositeHash, [...combined.values()]);
        }
        const effective = new Map(destinationEntries.map(e => [e.compositeHash, e.keywords]));
        for (const entry of sourceEntries) if (!effective.has(entry.compositeHash)) effective.set(entry.compositeHash, entry.keywords);
        for (const [hash, words] of keywords) effective.set(hash, words);
        for (const [hash, words] of keywords) {
          if (words.length > EMOTICON_KEYWORDS_PER_IMAGE) throw new GroupMoveError(`Merged keywords exceed the per-image limit for ${hash}`);
          for (const word of words) {
          const key = word.toLowerCase();
          const previous = targets.get(hash)?.keywords ?? [];
          if (target.emoticon_enabled && !previous.some(w => w.toLowerCase() === key) && [...effective].some(([other, values]) => other !== hash && values.some(w => w.toLowerCase() === key))) throw new GroupMoveError(`Keyword "${word}" would identify multiple media in group ${target.id}`);
          }
        }
        db.prepare(`INSERT INTO image_groups(group_id,composite_hash,added_date,order_index,collection_type,auto_collected_date,emote_keywords)
          SELECT ?,composite_hash,added_date,order_index,'manual',NULL,emote_keywords FROM image_groups WHERE group_id=?
          ON CONFLICT(group_id,composite_hash) DO UPDATE SET collection_type='manual',auto_collected_date=NULL`).run(target.id, id);
        const setKeywords = db.prepare('UPDATE image_groups SET emote_keywords=? WHERE group_id=? AND composite_hash=?');
        for (const [hash, words] of keywords) setKeywords.run(JSON.stringify(words), target.id, hash);
        for (const entry of sourceEntries) if (!targets.has(entry.compositeHash)) targets.set(entry.compositeHash, entry);
        for (const [hash, words] of keywords) targets.set(hash, { ...targets.get(hash)!, keywords: words, explicit: true });
        entryCache.set(target.id, [...targets.values()]);
        db.prepare(`INSERT INTO group_resources(group_id,resource_key,reference,label)
          SELECT ?,resource_key,reference,label FROM group_resources WHERE group_id=?
          ON CONFLICT(group_id,resource_key) DO NOTHING`).run(target.id, id);
        const children = db.prepare('SELECT id FROM groups WHERE parent_id=? ORDER BY id LIMIT 501').all(id) as { id: number }[];
        for (const child of children) move(child.id, target.id);
        db.prepare('DELETE FROM groups WHERE id=?').run(id);
        merged[id] = target.id;
      };
      for (const id of roots) move(id, parentId);
      const token = digest.digest('hex');
      if (!options.preview && conflicts.length && options.merge_token !== token) throw new GroupMoveError('Merge preview is stale; preview and confirm again');
      result = { moved: roots.length, conflicts, merged, merge_token: conflicts.length ? token : null };
      if (options.preview) throw previewMarker;
    }).immediate();
  } catch (error) {
    if (error !== previewMarker) throw error;
  }
  return result;
}
