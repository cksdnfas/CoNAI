import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

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

/** Mark one removed draft asset for delayed deletion so already queued jobs stay retryable. */
export function markWorkflowInputAssetForDeletion(assetId: string) {
  const absolutePath = resolveWorkflowInputAssetPath(assetId);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return false;
  }

  fs.writeFileSync(`${absolutePath}.deleted`, new Date().toISOString(), 'utf8');
  return true;
}

/** Delete workflow assets whose explicit removal grace period has elapsed. */
export function pruneDeletedWorkflowInputAssets(now = Date.now()) {
  const root = getWorkflowInputAssetStoreDir();
  if (!fs.existsSync(root)) {
    return 0;
  }

  let removed = 0;
  for (const shard of fs.readdirSync(root, { withFileTypes: true })) {
    if (!shard.isDirectory()) {
      continue;
    }

    const shardPath = path.join(root, shard.name);
    for (const entry of fs.readdirSync(shardPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.bin.deleted')) {
        continue;
      }

      const markerPath = path.join(shardPath, entry.name);
      const markerStats = fs.statSync(markerPath);
      if (now - markerStats.mtimeMs < WORKFLOW_INPUT_ASSET_DELETE_GRACE_MS) {
        continue;
      }

      const assetPath = markerPath.slice(0, -'.deleted'.length);
      fs.rmSync(assetPath, { force: true });
      fs.rmSync(markerPath, { force: true });
      removed += 1;
    }
  }

  return removed;
}
