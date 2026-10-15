import { z } from 'zod';
import { db } from '../database/init';
import { GroupModel } from '../models/Group';
import { createCustomGroup } from './groupMutationService';
import { WorkspaceService, WorkspaceError } from './workspaceService';
import { groupResourceSchema, validateGroupResource, attachGroupResources } from './groupResources';
import { requireContextPermission } from '../middleware/featureAccess';
import type { McpRequestContext } from '../mcp/context';
import type { WorkspaceOperation } from '@conai/shared';

const write = z.object({ target: z.string().min(1).max(1000), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), text: z.string().max(100000) });
export const workspacePublishSchema = z.object({
  requestId: z.string().regex(/^[\w-]{8,90}$/), groupId: z.number().int().positive(),
  resources: z.array(z.object({ category: z.string().trim().min(1).max(80).regex(/^[^/\\]+$/), reference: groupResourceSchema })).min(1).max(500),
  document: write,
  queue: z.object({ target: z.string().min(1).max(1000), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), entryId: z.string().min(1).max(200) }),
});

/** Memberships precede retirement. A failed CAS never proceeds to the next file.
 * Retrying membership inserts is safe; a document success + queue conflict leaves a recoverable receipt. */
export async function publishWorkspaceResources(context: McpRequestContext, owner: string, projectId: string, input: z.infer<typeof workspacePublishSchema>, checkAccess: () => void, signal?: AbortSignal) {
  requireContextPermission(context, 'images.view');
  requireContextPermission(context, 'images.edit');
  if (input.document.target.toLowerCase() === input.queue.target.toLowerCase()) throw new WorkspaceError('작업 문서와 목록은 서로 다른 파일이어야 해.');
  if ([input.document, input.queue].some(file => file.target.toLowerCase() === 'ai_guidelines.md') || input.document.text.includes('\0')) throw new WorkspaceError('지침 파일 또는 NUL 문자를 포함한 문서는 완료 대상으로 저장할 수 없어.');
  const check = () => {
    checkAccess();
    requireContextPermission(context, 'images.view');
    requireContextPermission(context, 'images.edit');
    for (const { reference } of input.resources) requireContextPermission(context, reference.source === 'audio' ? 'audio.view' : reference.source === 'library' ? 'images.view' : 'files.view');
  };
  const queueWrite = { kind: 'write' as const, target: input.queue.target, expectedRevision: input.queue.expectedRevision, text: '' };
  const operations: WorkspaceOperation[] = [{ kind: 'write', ...input.document }, queueWrite];
  const saved = await WorkspaceService.apply(owner, projectId, input.requestId, operations, check, signal, { inputIdentity: { groupId: input.groupId, resources: input.resources, entryId: input.queue.entryId }, beforeWrite: async () => {
    await WorkspaceService.read(owner, projectId, [{ target: input.document.target, revision: input.document.expectedRevision, limit: 4 }], signal);
    const { files: [file] } = await WorkspaceService.read(owner, projectId, [{ target: input.queue.target, revision: input.queue.expectedRevision, limit: 1048576 }], signal);
    if (file.nextOffset !== null) throw new WorkspaceError('진행 목록은 1MiB까지 지원해. 작업 공간을 나눠줘.');
    const queue = z.object({ items: z.array(z.object({ id: z.string(), target: z.string() }).passthrough()).max(5000) }).passthrough().parse(JSON.parse(file.text));
    const matches = queue.items.filter(item => item.id === input.queue.entryId && item.target === input.document.target);
    if (matches.length !== 1) throw new WorkspaceError('진행 목록의 작업 ID와 문서가 일치하지 않아.', 409);
    queueWrite.text = JSON.stringify({ ...queue, items: queue.items.filter(item => item !== matches[0]) }, null, 2) + '\n';
    for (const item of input.resources) { signal?.throwIfAborted(); await validateGroupResource(context, item.reference); }
    check(); signal?.throwIfAborted();
    db.transaction(() => {
      if (!GroupModel.findById(input.groupId)) throw new WorkspaceError('프로젝트 그룹이 없어.', 404);
      for (const category of new Set(input.resources.map(item => item.category))) {
        // Anchor by parent ID: a slash or a renamed ancestor must not redirect publication.
        const child = db.prepare('SELECT id FROM groups WHERE parent_id=? AND TRIM(name)=? COLLATE NOCASE ORDER BY id LIMIT 1').get(input.groupId, category) as { id: number } | undefined;
        const childId = child?.id ?? createCustomGroup({ name: category, parent_id: input.groupId }, context.requester?.accountId ?? null).id;
        attachGroupResources(childId, input.resources.filter(item => item.category === category).map(item => item.reference));
      }
    }).immediate();
  } });
  return { ...saved, groupId: input.groupId };
}
