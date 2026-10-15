import { z } from 'zod';
import fs from 'node:fs/promises';
import { db } from '../database/init';
import { GroupModel, ImageGroupModel } from '../models/Group';
import { MediaMetadataFileQueries } from '../models/Image/MediaMetadataFileQueries';
import { ImageFileModel } from '../models/Image/ImageFileModel';
import { resolveUploadsPath } from '../config/runtimePaths';
import { ImageSafetyService } from './imageSafetyService';
import { MediaPostprocessVisibilityService } from './mediaPostprocessVisibilityService';
import { audioCandidateFile } from './audio/audioService';
import { audioBlobPath } from './audio/audioStore';
import { libraryMediaAllowed } from './contentRating';
import { contextContentLimit } from './codex-chat/chatContentRating';
import { FileStoreService } from './fileStoreService';
import { requireFileStoreOwner } from './fileStoreAccess';
import { WorkspaceService, workspaceTarget, WorkspaceError } from './workspaceService';
import { requireContextPermission } from '../middleware/featureAccess';
import type { McpRequestContext } from '../mcp/context';

export const groupResourceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('library'), compositeHash: z.string().regex(/^(?:[a-f0-9]{32}|[a-f0-9]{48})$/), label: z.string().max(200) }),
  z.object({ source: z.literal('audio'), candidateId: z.string().uuid(), label: z.string().max(200) }),
  z.object({ source: z.literal('files'), fileId: z.string().regex(/^[a-f0-9]{32}$/), label: z.string().max(200) }),
  z.object({ source: z.literal('workspace'), projectId: z.string().regex(/^[a-f0-9]{32}$/), target: z.string().min(1).max(1000), label: z.string().max(200) }),
]);
export type GroupResource = z.infer<typeof groupResourceSchema>;
type Context = Pick<McpRequestContext, 'requester' | 'keyGroup' | 'contentRatingLimit' | 'chatContext'>;

export async function validateGroupResource(context: Context, ref: GroupResource) {
  requireContextPermission(context, ref.source === 'audio' ? 'audio.view' : ref.source === 'library' ? 'images.view' : 'files.view');
  if (ref.source === 'library') {
    const media = MediaMetadataFileQueries.findVisibilityGuardByHash(ref.compositeHash);
    if (!media || !MediaPostprocessVisibilityService.isReadyRecord(media) || ImageSafetyService.isHidden(media.rating_score)) throw new WorkspaceError('미디어가 없거나 현재 표시 정책에서 사용할 수 없어.', 404);
    if (!await libraryMediaAllowed(ref.compositeHash, contextContentLimit({ ...context, scopes: ['read'] }))) throw new WorkspaceError('표시 범위를 벗어난 미디어야.', 403);
    const file = ImageFileModel.findActiveByHash(ref.compositeHash)[0];
    if (!file || !await fs.stat(resolveUploadsPath(file.original_file_path)).then(s => s.isFile(), () => false)) throw new WorkspaceError('미디어 원본이 없어.', 404);
  } else if (ref.source === 'audio') {
    const { candidate, file } = audioCandidateFile(ref.candidateId);
    if (candidate.deleted_at || !await fs.stat(audioBlobPath(file.hash, file.ext)).then(s => s.isFile(), () => false)) throw new WorkspaceError('오디오 원본이 없거나 지워졌어.', 404);
  } else if (ref.source === 'files') FileStoreService.resolveFile(requireFileStoreOwner(context.requester), ref.fileId);
  else await WorkspaceService.stat(requireFileStoreOwner(context.requester), ref.projectId, workspaceTarget(ref.target));
}

export function resourceKey(ref: GroupResource) {
  return ref.source === 'library' ? `library:${ref.compositeHash}` : ref.source === 'audio' ? `audio:${ref.candidateId}` : ref.source === 'files' ? `files:${ref.fileId}` : `workspace:${ref.projectId}:${workspaceTarget(ref.target)}`;
}

/** Caller validates references before this synchronous transaction; retries only add missing memberships. */
export function attachGroupResources(groupId: number, refs: GroupResource[]) {
  return db.transaction(() => {
    if (!GroupModel.findById(groupId)) throw new WorkspaceError('대상 그룹이 없어.', 404);
    const hashes = refs.filter(r => r.source === 'library').map(r => r.compositeHash);
    if (hashes.length) {
      const result = ImageGroupModel.addImagesToGroupManually(groupId, hashes);
      if (result.missing_hashes.length) throw new WorkspaceError('그룹에 넣을 미디어가 없어.', 404);
    }
    const insert = db.prepare('INSERT INTO group_resources(group_id,resource_key,reference,label) VALUES(?,?,?,?) ON CONFLICT(group_id,resource_key) DO NOTHING');
    for (const ref of refs) if (ref.source !== 'library') insert.run(groupId, resourceKey(ref), JSON.stringify(ref), ref.label);
    return { groupId, count: refs.length };
  }).immediate();
}

export async function listGroupResources(context: Context, groupId: number, offset = 0) {
  requireContextPermission(context, 'images.view');
  const rows = db.prepare('SELECT id,reference FROM group_resources WHERE group_id=? ORDER BY id LIMIT 31 OFFSET ?').all(groupId, offset) as { id: number; reference: string }[];
  const entries = [];
  for (const row of rows.slice(0, 30)) {
    const reference = groupResourceSchema.parse(JSON.parse(row.reference));
    // Do not expose labels or IDs from a source the account cannot read.
    try {
      requireContextPermission(context, reference.source === 'audio' ? 'audio.view' : 'files.view');
      if (reference.source !== 'audio') requireFileStoreOwner(context.requester);
    } catch { continue; }
    let available = true;
    try { await validateGroupResource(context, reference); } catch { available = false; }
    entries.push({ id: row.id, ...reference, available });
  }
  return { entries, nextOffset: rows.length > 30 ? offset + 30 : null };
}
