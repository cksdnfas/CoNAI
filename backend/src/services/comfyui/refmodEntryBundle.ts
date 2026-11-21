import type { Readable } from 'stream';
import yauzl from 'yauzl';
import { z } from 'zod';
import {
  REFMOD_BUNDLE_DOCUMENT,
  REFMOD_BUNDLE_FORMAT,
  REFMOD_ENTRY_LIMITS,
  type RefModBundle,
  type RefModBundleEntry,
  type RefModEntryMember,
  type RefModImportResult,
} from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { MAX_UPLOAD_FILE_SIZE_BYTES } from '../../middleware/upload';
import { visibleWorkflowFields } from '../workflowHiddenFieldPolicy';
import { refModMediaExtension } from './refmodRecords';
import {
  defaultRefModWorkflowId,
  normalizeRefModEntryName,
  refModEntryInternals as internals,
  refModEntryRowsForExport,
  type RefModEntryActor,
  type RefModEntryRow,
} from './refmodEntries';
import {
  ensureRefModEntryFolder,
  isRefModEntryFileRef,
  RefModEntryError,
  refModEntryFileRef,
  releaseRefModFiles,
  resolveRefModEntryFile,
  storeRefModSource,
} from './refmodEntryFiles';

/**
 * Moving entries between instances: refmods.json plus each source under media/. No server, workflow, history or queue
 * ids travel; an import takes the target's default creation workflow and applies extras only to a field with the same
 * id and type. The import reads the archive through its central directory and streams one entry at a time.
 */

const BUNDLE_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
const BUNDLE_MAX_ENTRIES = 20_000;
const { DIRECTOR_META_KEY, isRecord, parseJson } = internals;
const db = () => getUserSettingsDb();

// ---------------------------------------------------------------- export

export function exportRefModEntries(input: unknown, canViewImages: boolean): { document: RefModBundle; files: Array<{ name: string; path: string }> } {
  const parsed = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000).optional() }).strict().safeParse(input ?? {});
  if (!parsed.success) throw new RefModEntryError('내보낼 RefMod를 골라줘.');
  const rows = refModEntryRowsForExport(parsed.data.ids);
  if (!rows.length) throw new RefModEntryError('내보낼 RefMod가 없어.', 404);
  const workflows = internals.makeWorkflowCache();
  const files: Array<{ name: string; path: string }> = [];
  const entries = rows.map((row, entryIndex): RefModBundleEntry => {
    const stored = parseJson<Record<string, any> | null>(row.director_value, null);
    let director: Record<string, unknown> | null = null;
    if (isRecord(stored)) {
      const meta = isRecord(stored[DIRECTOR_META_KEY]) ? stored[DIRECTOR_META_KEY] : {};
      const assets: Record<string, unknown> = {};
      let fileIndex = 0;
      for (const [key, asset] of Object.entries(isRecord(meta.assets) ? meta.assets : {})) {
        const file = canViewImages && isRefModEntryFileRef(asset) ? resolveRefModEntryFile(row.id, asset.id) : null;
        if (!file || !isRefModEntryFileRef(asset)) continue;
        fileIndex += 1;
        const bundleFile = `media/${entryIndex + 1}/${fileIndex}.${refModMediaExtension(file.mimeType)}`;
        files.push({ name: bundleFile, path: file.filePath });
        assets[key] = { bundleFile, fileName: asset.fileName, mimeType: file.mimeType };
      }
      director = { ...stored, [DIRECTOR_META_KEY]: { assets } };
    }
    const info = workflows(row.workflow_id);
    const extraValues = parseJson<Record<string, unknown>>(row.extra_values, {});
    const roleIds = new Set(info ? Object.values(info.roles.roles).filter(Boolean) : []);
    const extras = info ? visibleWorkflowFields(info.fields)
      .filter((field) => !roleIds.has(field.id) && Object.prototype.hasOwnProperty.call(extraValues, field.id))
      .map((field) => ({ id: field.id, label: field.label || field.id, type: field.type, value: extraValues[field.id] })) : [];
    return {
      name: row.name,
      conceptType: row.concept_type,
      description: row.description,
      keywords: parseJson<string[]>(row.keywords, []),
      favorite: row.favorite === 1,
      director,
      members: parseJson<RefModEntryMember[]>(row.members, []).map(({ fileId, ...member }) => member),
      extras,
    };
  });
  return { document: { format: REFMOD_BUNDLE_FORMAT, version: 1, entries }, files };
}

// ---------------------------------------------------------------- streaming ZIP access

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(new RefModEntryError('ZIP 파일을 읽지 못했어. CoNAI에서 내보낸 RefMod 묶음인지 확인해줘.'));
      else resolve(zip);
    });
  });
}

/** Central-directory listing only (names and sizes); no entry data is read here. */
function listZipEntries(zip: yauzl.ZipFile): Promise<Map<string, yauzl.Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, yauzl.Entry>();
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entries.size >= BUNDLE_MAX_ENTRIES) { reject(new RefModEntryError('묶음에 파일이 너무 많아.')); return; }
      if (!entry.fileName.endsWith('/') && !entry.isEncrypted()) entries.set(entry.fileName, entry);
      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.once('error', () => reject(new RefModEntryError('ZIP 파일을 읽지 못했어.')));
    zip.readEntry();
  });
}

function openEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(new RefModEntryError(`묶음의 ${entry.fileName}을 읽지 못했어.`));
      else resolve(stream);
    });
  });
}

async function readEntryText(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number): Promise<string> {
  if (entry.uncompressedSize > maxBytes) throw new RefModEntryError(`${entry.fileName}가 너무 커.`);
  const stream = await openEntryStream(zip, entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) { stream.destroy(); throw new RefModEntryError(`${entry.fileName}가 너무 커.`); }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------- import

const bundleAssetSchema = z.object({ bundleFile: z.string().min(1).max(500), fileName: z.string().max(500).optional(), mimeType: z.string().max(200) });
const documentSchema = z.object({
  format: z.literal(REFMOD_BUNDLE_FORMAT),
  version: z.literal(1),
  entries: z.array(z.object({
    name: z.string(),
    conceptType: z.string().trim().min(1).max(40).catch('generic'),
    description: z.string().max(REFMOD_ENTRY_LIMITS.description).catch(''),
    keywords: z.array(z.string().trim().min(1).max(REFMOD_ENTRY_LIMITS.keyword)).max(REFMOD_ENTRY_LIMITS.keywords).catch([]),
    favorite: z.boolean().catch(false),
    director: z.record(z.string(), z.unknown()).nullable().catch(null),
    members: z.array(z.record(z.string(), z.unknown())).catch([]),
    extras: z.array(z.object({ id: z.string(), label: z.string().optional(), type: z.string(), value: z.unknown() })).catch([]),
  })).max(5000),
});

/** Members of a metadata-only entry (no Director value) as the bundle lists them, without files. */
function bundleMembers(members: Array<Record<string, unknown>>): RefModEntryMember[] {
  return members.flatMap((member, index) => internals.KINDS.has(member.kind as string) ? [{
    index, kind: member.kind as RefModEntryMember['kind'], description: typeof member.description === 'string' ? member.description : '',
    fileId: null, fileName: null, mimeType: null, mediaMode: null, trimStart: null, trimEnd: null, sourceWidth: null, sourceHeight: null, sourceDuration: null,
  }] : []);
}

export async function importRefModEntries(input: { bundlePath: string; conflict?: unknown }, actor: RefModEntryActor): Promise<RefModImportResult> {
  const conflict = input.conflict === undefined || input.conflict === '' ? 'skip' : input.conflict;
  if (conflict !== 'skip' && conflict !== 'overwrite') throw new RefModEntryError('conflict는 skip이나 overwrite여야 해.');
  const zip = await openZip(input.bundlePath);
  try {
    const entries = await listZipEntries(zip);
    const documentEntry = entries.get(REFMOD_BUNDLE_DOCUMENT);
    if (!documentEntry) throw new RefModEntryError(`묶음에 ${REFMOD_BUNDLE_DOCUMENT}가 없어. CoNAI에서 내보낸 RefMod 묶음인지 확인해줘.`);
    let raw: unknown;
    try { raw = JSON.parse(await readEntryText(zip, documentEntry, BUNDLE_DOCUMENT_MAX_BYTES)); }
    catch (error) { throw error instanceof RefModEntryError ? error : new RefModEntryError(`${REFMOD_BUNDLE_DOCUMENT}를 읽지 못했어.`); }
    const parsed = documentSchema.safeParse(raw);
    if (!parsed.success) throw new RefModEntryError(`${REFMOD_BUNDLE_DOCUMENT} 형식이 맞지 않아.`);
    const result: RefModImportResult = { created: 0, overwritten: 0, skipped: 0, importedFiles: 0, droppedFiles: 0 };
    const workflows = internals.makeWorkflowCache();
    const defaultWorkflowId = defaultRefModWorkflowId();
    for (const bundled of parsed.data.entries) {
      let name: string;
      try { name = normalizeRefModEntryName(bundled.name); } catch { result.skipped += 1; continue; }
      const existing = internals.findEntryByName(name);
      if (existing && conflict === 'skip') { result.skipped += 1; continue; }
      await importOne(zip, entries, bundled, name, existing ? internals.requireRow(existing.id) : null, defaultWorkflowId, workflows, actor, result);
    }
    return result;
  } finally {
    zip.close();
  }
}

async function importOne(
  zip: yauzl.ZipFile, entries: Map<string, yauzl.Entry>, bundled: z.infer<typeof documentSchema>['entries'][number], name: string,
  existing: RefModEntryRow | null, defaultWorkflowId: number | null, workflows: ReturnType<typeof internals.makeWorkflowCache>,
  actor: RefModEntryActor, result: RefModImportResult,
) {
  const existingWorkflow = existing ? workflows(existing.workflow_id) : null;
  const workflowId = existingWorkflow?.roles.linkable ? existingWorkflow.workflow.id : defaultWorkflowId;
  let row = existing;
  if (!row) {
    try {
      const id = Number(db().prepare('INSERT INTO refmod_entries (name, workflow_id) VALUES (?, ?)').run(name, workflowId).lastInsertRowid);
      row = internals.requireRow(id);
    } catch (error) {
      if (internals.isUniqueViolation(error)) { result.skipped += 1; return; }
      throw error;
    }
  }
  const target = row;
  const created: string[] = [];
  try {
    let director: Record<string, any> | null = null;
    let members: RefModEntryMember[] = bundleMembers(bundled.members);
    const folder: { id: string | null } = { id: null };
    if (bundled.director) {
      const parsedDirector = internals.parseDirector(bundled.director);
      const meta = isRecord(bundled.director[DIRECTOR_META_KEY]) ? bundled.director[DIRECTOR_META_KEY] as Record<string, any> : {};
      const bundledAssets = isRecord(meta.assets) ? meta.assets : {};
      const assets: Record<string, unknown> = {};
      for (const item of parsedDirector.items) {
        const key = String(item.id ?? '');
        if (!key || bundledAssets[key] === undefined) continue;
        const asset = bundleAssetSchema.safeParse(bundledAssets[key]);
        const zipEntry = asset.success ? entries.get(asset.data.bundleFile) : undefined;
        if (!asset.success || !zipEntry || zipEntry.uncompressedSize > MAX_UPLOAD_FILE_SIZE_BYTES || !internals.KINDS.has(item.type)) { result.droppedFiles += 1; continue; }
        try {
          folder.id ??= ensureRefModEntryFolder(actor.owner, target.name, target.folder_id);
          const stored = await storeRefModSource(actor.owner, folder.id, { stream: await openEntryStream(zip, zipEntry) }, {
            kind: item.type, mimeType: asset.data.mimeType, fileName: asset.data.fileName ?? null,
          });
          created.push(stored.fileId);
          assets[key] = refModEntryFileRef(target.id, stored);
          result.importedFiles += 1;
        } catch (error) {
          // A damaged or unreadable entry (CRC, size, content check) drops that source only.
          if (!(error instanceof RefModEntryError)) console.warn(`[RefMod import] Dropped ${asset.data.bundleFile}:`, error instanceof Error ? error.message : error);
          result.droppedFiles += 1;
        }
      }
      director = { ...bundled.director, [DIRECTOR_META_KEY]: { assets } };
      members = internals.deriveMembers(internals.parseDirector(director), assets);
    }
    const info = workflows(workflowId);
    const roleIds = new Set(info ? Object.values(info.roles.roles).filter(Boolean) : []);
    const fields = info ? visibleWorkflowFields(info.fields) : [];
    const extras: Record<string, unknown> = {};
    for (const extra of bundled.extras) {
      if (!roleIds.has(extra.id) && fields.some((field) => field.id === extra.id && field.type === extra.type)) extras[extra.id] = extra.value;
    }
    let removed: string[] = [];
    db().transaction(() => {
      removed = internals.replaceEntryFiles(target.id, new Set(created));
      db().prepare(`UPDATE refmod_entries SET concept_type = ?, description = ?, keywords = ?, favorite = ?, director_value = ?, members = ?,
        extra_values = ?, workflow_id = ?, folder_id = COALESCE(?, folder_id), revision = revision + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        bundled.conceptType, bundled.description, JSON.stringify([...new Map(bundled.keywords.map((item) => [item.toLowerCase(), item])).values()]),
        bundled.favorite ? 1 : 0, director ? JSON.stringify(director) : null, JSON.stringify(members), JSON.stringify(extras), workflowId,
        folder.id, existing ? 1 : 0, target.id);
    }).immediate();
    internals.afterSourcesCommitted(actor, [], removed);
    internals.storeCarriedInputs(target.id);
    if (existing) result.overwritten += 1;
    else result.created += 1;
  } catch (error) {
    releaseRefModFiles(actor.owner, created);
    if (!existing) internals.deleteEntryRows(target.id);
    throw error;
  }
}
