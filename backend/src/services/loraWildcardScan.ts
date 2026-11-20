import { getUserSettingsDb } from '../database/userSettingsDb';
import { prepareWildcardInsert } from '../models/Wildcard';

type LoraFile = { folderName: string; loraName: string; promptLines?: string[] | null };
type DuplicateHandling = 'number' | 'parent';
type Folder = { folderName: string; parentPath: string | null; basename: string; depth: number; hasChildren: boolean; items: string[] };
type Entry = { id: number; name: string; folderName: string; level: number; itemCount: number; parentPath: string | null };
type StoredRow = { id: number; name: string; parent_id: number | null; is_auto_collected: number };
const LOG_KEY = 'last_lora_scan_log';

export function isLoraScanFile(file: unknown): file is LoraFile {
  if (!file || typeof file !== 'object') return false;
  const { folderName, loraName, promptLines } = file as Partial<LoraFile>;
  return typeof folderName === 'string' && folderName.split('/').every(part => part.trim().length > 0)
    && typeof loraName === 'string' && loraName.trim().length > 0
    && (promptLines == null || (Array.isArray(promptLines) && promptLines.every(line => typeof line === 'string')));
}

function collectFolders(files: LoraFile[], weight: number) {
  const folders = new Map<string, Folder>();
  let deepest = 0;
  for (const file of files) {
    let folder = folders.get(file.folderName);
    if (!folder) {
      let parentPath: string | null = null;
      const parts = file.folderName.split('/');
      deepest = Math.max(deepest, parts.length);
      for (const [i, basename] of parts.entries()) {
        const folderName: string = parentPath === null ? basename : `${parentPath}/${basename}`;
        folder = folders.get(folderName);
        if (!folder) {
          folder = { folderName, parentPath, basename, depth: i + 1, hasChildren: false, items: [] };
          folders.set(folderName, folder);
        }
        if (i + 1 < parts.length) folder.hasChildren = true;
        parentPath = folderName;
      }
    }
    const tag = `<lora:${file.loraName}:${weight}>`;
    const lines = file.promptLines?.map(line => line.trim()).filter(Boolean);
    if (lines?.length) for (const line of lines) folder!.items.push(`${tag}, ${line}`);
    else folder!.items.push(tag);
  }
  return [...folders.values()].map(folder => ({ ...folder, level: folder.hasChildren ? deepest - folder.depth + 1 : 1 }))
    .sort((a, b) => a.level - b.level);
}

export function replaceLoraWildcards(files: LoraFile[], loraWeight: number, duplicateHandling: DuplicateHandling) {
  const folders = collectFolders(files, loraWeight);
  const db = getUserSettingsDb();
  return db.transaction(() => {
    const rows = db.prepare('SELECT id, name, parent_id, is_auto_collected FROM wildcards').all() as StoredRow[];
    const rowsById = new Map(rows.map(row => [row.id, row]));
    // Older scans used source_path=NULL. The last completed scan already records the folder for each generated ID.
    const previous = db.prepare(`SELECT x.value ->> '$.id' AS id, x.value ->> '$.name' AS name,
      x.value ->> '$.folderName' AS folderName, p.value ->> '$.duplicateHandling' AS mode
      FROM user_preferences p, json_each(CASE WHEN json_valid(p.value) THEN p.value END, '$.wildcards') x
      WHERE p.key = ? AND x.type = 'object'`).all(LOG_KEY) as { id: number; name: string; folderName: string; mode: string }[];
    const autoEntries = previous.filter(entry => rowsById.get(entry.id)?.is_auto_collected && typeof entry.folderName === 'string');
    const oldPath = new Map(autoEntries.map(entry => [entry.id, entry.folderName]));
    const byPath = new Map(autoEntries.map(entry => [entry.folderName, entry]));
    const usedIds = new Set(rowsById.keys());
    const usedNames = new Set(rows.filter(row => !row.is_auto_collected).map(row => row.name));
    const survivingNames = new Map<string, string>();
    for (const folder of folders) {
      const old = byPath.get(folder.folderName);
      if (old?.mode === duplicateHandling && typeof old.name === 'string' && !usedNames.has(old.name)) {
        survivingNames.set(folder.folderName, old.name);
        usedNames.add(old.name);
      }
    }
    const nextIds = new Map<number, number>();
    const nextSuffix = new Map<string, number>();
    const entries: Entry[] = folders.map(({ folderName, basename, parentPath, level, items }) => {
      let id = byPath.get(folderName)?.id;
      if (id === undefined) {
        id = nextIds.get(level) ?? level * 100000 + 1;
        while (usedIds.has(id)) id++;
        nextIds.set(level, id + 1);
        usedIds.add(id);
      }
      let name = survivingNames.get(folderName);
      if (name === undefined) {
        const base = usedNames.has(basename) && duplicateHandling === 'parent' && parentPath
          ? `${parentPath.split('/').at(-1)}_${basename}` : basename;
        name = base;
        if (usedNames.has(name)) {
          let suffix = nextSuffix.get(base) ?? 2;
          while (usedNames.has(`${base}_${suffix}`)) suffix++;
          name = `${base}_${suffix}`;
          nextSuffix.set(base, suffix + 1);
        }
        usedNames.add(name);
      }
      return { id, name, folderName, level, itemCount: items.length, parentPath };
    });

    const idByPath = new Map(entries.map(entry => [entry.folderName, entry.id]));
    db.prepare('DELETE FROM wildcards WHERE is_auto_collected = 1').run();
    const insert = prepareWildcardInsert();
    for (const [i, entry] of entries.entries()) {
      insert({ name: entry.name, description: `Auto-generated from ${entry.folderName}`, customId: entry.id,
        parent_id: entry.parentPath === null ? null : idByPath.get(entry.parentPath)!, include_children: 1,
        items: { general: [], nai: [], comfyui: folders[i].items.map(content => ({ content, weight: 1 })) },
      }, loraWeight);
    }
    // Single-node removal normally promotes manual children. Preserve that rule when their old scan folder disappears.
    const reparent = db.prepare('UPDATE wildcards SET parent_id = ? WHERE id = ?');
    for (const row of rows) {
      if (row.is_auto_collected || row.parent_id === null || !rowsById.get(row.parent_id)?.is_auto_collected) continue;
      let parent: number | null = row.parent_id;
      const visited = new Set<number>();
      while (parent !== null && rowsById.get(parent)?.is_auto_collected) {
        const replacement = idByPath.get(oldPath.get(parent) ?? '');
        if (replacement !== undefined) { parent = replacement; break; }
        if (visited.has(parent)) { parent = null; break; }
        visited.add(parent);
        parent = rowsById.get(parent)!.parent_id;
      }
      if (parent !== row.parent_id) reparent.run(parent, row.id);
    }
    const log = { timestamp: new Date().toISOString(), loraWeight, duplicateHandling, totalWildcards: entries.length,
      totalItems: entries.reduce((sum, entry) => sum + entry.itemCount, 0), wildcards: entries };
    db.prepare(`INSERT INTO user_preferences (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(LOG_KEY, JSON.stringify(log));
    return { created: entries.length, log };
  }).immediate();
}
