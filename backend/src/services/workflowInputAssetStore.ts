import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { chunkSqliteValues, sqliteInPlaceholders } from '../utils/sqliteBatch';
import { moveFileWithoutReplacing } from '../utils/recycleBin';

export const WORKFLOW_INPUT_ASSET_REF_KIND = 'workflow-input-asset';

const WORKFLOW_INPUT_ASSET_ID_PATTERN = /^[a-f0-9]{32}$/;
const WORKFLOW_INPUT_ASSET_DELETE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export type WorkflowInputAssetRef = {
  __ref: typeof WORKFLOW_INPUT_ASSET_REF_KIND;
  id: string;
  fileName: string;
  mimeType?: string;
  bytes: number;
};

export class WorkflowInputAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowInputAssetError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Return the private runtime directory used by persistent workflow draft media. */
export function getWorkflowInputAssetStoreDir() {
  return path.join(runtimePaths.basePath, 'workflow-input-assets');
}

/** Recognize one bounded workflow input asset reference from an untrusted payload. */
export function isWorkflowInputAssetRef(value: unknown): value is WorkflowInputAssetRef {
  return isPlainObject(value)
    && value.__ref === WORKFLOW_INPUT_ASSET_REF_KIND
    && typeof value.id === 'string'
    && WORKFLOW_INPUT_ASSET_ID_PATTERN.test(value.id)
    && typeof value.fileName === 'string'
    && typeof value.bytes === 'number';
}

/** Resolve one asset id to its private on-disk file path. */
export function resolveWorkflowInputAssetPath(assetId: string) {
  if (!WORKFLOW_INPUT_ASSET_ID_PATTERN.test(assetId)) {
    return null;
  }

  return path.join(getWorkflowInputAssetStoreDir(), assetId.slice(0, 2), `${assetId}.bin`);
}

/** Resolve a stored asset reference only when its backing file still exists. */
export function resolveWorkflowInputAssetFilePath(ref: WorkflowInputAssetRef) {
  const absolutePath = resolveWorkflowInputAssetPath(ref.id);
  return absolutePath && fs.existsSync(absolutePath) ? absolutePath : null;
}

/** Move one completed multipart upload into the persistent workflow input store. */
export function storeWorkflowInputAssetFile(
  temporaryPath: string,
  input: { fileName: string; mimeType?: string; bytes: number },
): WorkflowInputAssetRef {
  const id = crypto.randomBytes(16).toString('hex');
  const absolutePath = resolveWorkflowInputAssetPath(id);
  if (!absolutePath) {
    throw new Error('Failed to allocate workflow input asset id');
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.renameSync(temporaryPath, absolutePath);

  return {
    __ref: WORKFLOW_INPUT_ASSET_REF_KIND,
    id,
    fileName: input.fileName,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    bytes: input.bytes,
  };
}

/** Give a graph-to-queue copy its own identity, so an abandoned copy never aliases another job's input. */
export async function storeGraphQueueInputFile(filePath: string, input: { fileName: string; mimeType?: string; executionId: number }): Promise<WorkflowInputAssetRef> {
  const id = crypto.randomBytes(16).toString('hex');
  const absolutePath = resolveWorkflowInputAssetPath(id)!;
  const markerPath = `${absolutePath}.deleted`;
  const graphMarkerPath = `${absolutePath}.graph`;
  const stagingPath = `${absolutePath}.part`;
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(markerPath, new Date().toISOString(), { encoding: 'utf8', flag: 'wx' });
  let ownsStage = false;
  let ownsFile = false;
  let ownsGraphMarker = false;
  try {
    await fs.promises.writeFile(graphMarkerPath, String(input.executionId), { encoding: 'utf8', flag: 'wx' });
    ownsGraphMarker = true;
    await fs.promises.copyFile(filePath, stagingPath, fs.constants.COPYFILE_EXCL);
    ownsStage = true;
    const stats = await fs.promises.stat(stagingPath);
    await moveFileWithoutReplacing(stagingPath, absolutePath);
    ownsStage = false;
    ownsFile = true;
    return { __ref: WORKFLOW_INPUT_ASSET_REF_KIND, id, fileName: input.fileName, mimeType: input.mimeType, bytes: stats.size };
  } catch (error) {
    if (ownsStage || (error as NodeJS.ErrnoException).code !== 'EEXIST') await fs.promises.rm(stagingPath, { force: true });
    if (ownsFile) await fs.promises.rm(absolutePath, { force: true });
    if (ownsGraphMarker) await fs.promises.rm(graphMarkerPath, { force: true });
    await fs.promises.rm(markerPath, { force: true });
    throw error;
  }
}

/** Mark one removed draft asset for delayed deletion so already queued jobs stay retryable. */
export function markWorkflowInputAssetForDeletion(assetId: string) {
  const absolutePath = resolveWorkflowInputAssetPath(assetId);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return false;
  }

  fs.writeFileSync(`${absolutePath}.deleted`, new Date().toISOString(), 'utf8');
  return true;
}

/** Collect asset references from an entire stored payload without a nesting cutoff. */
export function collectWorkflowInputAssetRefs(value: unknown): WorkflowInputAssetRef[] {
  const refs = new Map<string, WorkflowInputAssetRef>();
  const pending = [value];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (isWorkflowInputAssetRef(node)) {
      refs.set(node.id, node);
    } else if (Array.isArray(node)) {
      for (const entry of node) pending.push(entry);
    } else {
      for (const entry of Object.values(node)) pending.push(entry);
    }
  }
  return [...refs.values()];
}

function ensureWorkflowInputAssetRefs() {
  const db = getUserSettingsDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_input_asset_job_refs (
      job_id INTEGER NOT NULL REFERENCES generation_queue_jobs(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      PRIMARY KEY (job_id, asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_input_asset_job_refs_asset
      ON workflow_input_asset_job_refs(asset_id);
  `);
  return db;
}

function graphCopyOwner(file: string): number | null {
  try {
    const owner = Number(fs.readFileSync(`${file}.graph`, 'utf8'));
    return Number.isSafeInteger(owner) && owner > 0 ? owner : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Discard only graph-owned copies which were not claimed by a successfully committed queue job. */
export function releaseUnclaimedGraphInputs(refs: WorkflowInputAssetRef[]) {
  if (!refs.length) return;
  const db = ensureWorkflowInputAssetRefs();
  const isReferenced = db.prepare('SELECT 1 FROM workflow_input_asset_job_refs WHERE asset_id = ? LIMIT 1');
  db.transaction(() => {
    for (const ref of refs) {
      if (isReferenced.get(ref.id)) continue;
      const file = resolveWorkflowInputAssetPath(ref.id)!;
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}.deleted`, { force: true });
      fs.rmSync(`${file}.graph`, { force: true });
      fs.rmSync(`${file}.claimed`, { force: true });
    }
  }).immediate();
}

/** Claim refs in the queue job's creation transaction. Missing files must not create broken jobs. */
export function registerWorkflowInputAssetRefs(jobId: number, refs: WorkflowInputAssetRef[], requireFiles = true) {
  if (!refs.length) return;
  const db = ensureWorkflowInputAssetRefs();
  const insert = db.prepare('INSERT OR IGNORE INTO workflow_input_asset_job_refs (job_id, asset_id) VALUES (?, ?)');
  for (const ref of refs) {
    if (requireFiles && !resolveWorkflowInputAssetFilePath(ref)) {
      throw new WorkflowInputAssetError(`워크플로 입력 파일을 찾을 수 없어: ${ref.id}. 다시 첨부해줘.`);
    }
    insert.run(jobId, ref.id);
    const file = resolveWorkflowInputAssetPath(ref.id)!;
    if (graphCopyOwner(file) !== null) fs.writeFileSync(`${file}.claimed`, '', { flag: 'a' });
  }
}

/** Release claims only once the job payload can no longer be retried. */
export function releaseWorkflowInputAssetRefs(jobIds: number[]) {
  if (!jobIds.length) return;
  const db = ensureWorkflowInputAssetRefs();
  db.transaction(() => {
    const stillReferenced = db.prepare('SELECT 1 FROM workflow_input_asset_job_refs WHERE asset_id = ? LIMIT 1');
    for (const chunk of chunkSqliteValues(jobIds)) {
      const placeholders = sqliteInPlaceholders(chunk);
      const candidates = db.prepare(`SELECT DISTINCT asset_id FROM workflow_input_asset_job_refs WHERE job_id IN (${placeholders})`).all(...chunk) as Array<{ asset_id: string }>;
      db.prepare(`
        DELETE FROM workflow_input_asset_job_refs
        WHERE job_id IN (${placeholders})
          AND (
            NOT EXISTS (SELECT 1 FROM generation_queue_jobs j WHERE j.id = workflow_input_asset_job_refs.job_id)
            OR EXISTS (
              SELECT 1 FROM generation_queue_jobs j
              WHERE j.id = workflow_input_asset_job_refs.job_id
                AND j.status IN ('completed', 'failed', 'cancelled')
                AND CASE WHEN json_valid(j.request_payload) THEN json_extract(j.request_payload, '$.pruned') = 1 ELSE 0 END
            )
          )
      `).run(...chunk);
      for (const { asset_id: assetId } of candidates) {
        const file = resolveWorkflowInputAssetPath(assetId);
        if (!file || stillReferenced.get(assetId) || graphCopyOwner(file) === null) continue;
        fs.rmSync(file, { force: true });
        fs.rmSync(`${file}.deleted`, { force: true });
        fs.rmSync(`${file}.graph`, { force: true });
        fs.rmSync(`${file}.claimed`, { force: true });
      }
    }
  }).immediate();
}

const backfilledDatabases = new WeakSet<object>();

/** Register pre-existing jobs in small batches before the first collection in this process. */
async function backfillWorkflowInputAssetRefs() {
  const db = ensureWorkflowInputAssetRefs();
  if (backfilledDatabases.has(db)) return;
  let cursor = 0;
  const page = db.prepare('SELECT id FROM generation_queue_jobs WHERE id > ? ORDER BY id LIMIT 32');
  const read = db.prepare('SELECT request_payload FROM generation_queue_jobs WHERE id = ?');
  while (true) {
    const rows = page.all(cursor) as Array<{ id: number }>;
    if (!rows.length) break;
    for (const row of rows) {
      db.transaction(() => {
        const current = read.get(row.id) as { request_payload: string } | undefined;
        if (!current) return;
        let payload: unknown;
        try {
          payload = JSON.parse(current.request_payload);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          console.warn(`Skipping malformed queue payload ${row.id} during workflow input backfill`);
          return;
        }
        const refs = collectWorkflowInputAssetRefs(payload);
        registerWorkflowInputAssetRefs(row.id, refs, false);
      }).immediate();
    }
    cursor = rows[rows.length - 1].id;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  backfilledDatabases.add(db);
}

/** Collect explicitly removed assets in the background, preserving retryable jobs and live graph runs. */
export async function pruneDeletedWorkflowInputAssets(now = Date.now()) {
  await backfillWorkflowInputAssetRefs();
  const root = getWorkflowInputAssetStoreDir();
  let rootDir: fs.Dir;
  try {
    rootDir = await fs.promises.opendir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  const db = ensureWorkflowInputAssetRefs();
  const isReferenced = db.prepare('SELECT 1 FROM workflow_input_asset_job_refs WHERE asset_id = ? LIMIT 1');
  const hasLiveGraph = db.prepare("SELECT 1 FROM graph_executions WHERE status IN ('queued', 'running') LIMIT 1");
  const hasLiveOwner = db.prepare("SELECT 1 FROM graph_executions WHERE id = ? AND status IN ('queued', 'running') LIMIT 1");
  let removed = 0;
  for await (const shard of rootDir) {
    if (!shard.isDirectory() || !/^[a-f0-9]{2}$/.test(shard.name)) continue;
    const shardPath = path.join(root, shard.name);
    const shardDir = await fs.promises.opendir(shardPath);
    for await (const entry of shardDir) {
      if (!entry.isFile() || !/^[a-f0-9]{32}\.bin\.deleted$/.test(entry.name)) continue;
      const assetId = entry.name.slice(0, 32);
      if (!assetId.startsWith(shard.name)) continue;
      const markerPath = path.join(shardPath, entry.name);
      const assetPath = markerPath.slice(0, -'.deleted'.length);
      try {
        const markerStats = await fs.promises.stat(markerPath);
        let graphMarkerExists = true;
        try {
          await fs.promises.access(`${assetPath}.graph`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          graphMarkerExists = false;
        }
        if (!graphMarkerExists && now - markerStats.mtimeMs < WORKFLOW_INPUT_ASSET_DELETE_GRACE_MS) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      // The DB write lock serializes the final check and unlink with new queue/graph rows, including other processes.
      const deleted = db.transaction(() => {
        if (isReferenced.get(assetId)) return false;
        const owner = graphCopyOwner(assetPath);
        if (owner === null ? hasLiveGraph.get() : !fs.existsSync(`${assetPath}.claimed`) && hasLiveOwner.get(owner)) return false;
        let markerStats: fs.Stats;
        try {
          markerStats = fs.statSync(markerPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw error;
        }
        if (owner === null && now - markerStats.mtimeMs < WORKFLOW_INPUT_ASSET_DELETE_GRACE_MS) return false;
        fs.rmSync(assetPath, { force: true });
        fs.rmSync(`${assetPath}.part`, { force: true });
        fs.rmSync(markerPath, { force: true });
        if (owner !== null) {
          fs.rmSync(`${assetPath}.graph`, { force: true });
          fs.rmSync(`${assetPath}.claimed`, { force: true });
        }
        return true;
      }).immediate();
      if (deleted) removed += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return removed;
}
