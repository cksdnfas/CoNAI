import type { PostCommentCursor } from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { PostError, type PostActor } from './postActor';
import type { CommentRow } from './postStore';

export const COMMENT_PAGE_SIZE = 40;
export type CommentPageInput = { parentId?: unknown; before?: unknown; focusIds?: unknown };
const ORDER = 'ORDER BY created_at DESC, id DESC';

function visibility(actor: PostActor, visibleOnly = false) {
  return visibleOnly ? { sql: "status = 'visible'", params: [] } : {
    sql: "(status != 'hidden' OR ? OR owner_account_id IS ?)", params: [actor.isAdmin ? 1 : 0, actor.accountId],
  };
}

function validId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new PostError('잘못된 댓글 ID야.');
  return value;
}

function cursorOf(row: CommentRow): PostCommentCursor {
  return { createdAt: row.created_at, id: row.id };
}

function splitPage(rows: CommentRow[]) {
  const hasMore = rows.length > COMMENT_PAGE_SIZE;
  const page = rows.slice(0, COMMENT_PAGE_SIZE);
  const nextCursor = hasMore ? cursorOf(page[page.length - 1]) : null;
  return { rows: page.reverse(), nextCursor };
}

/** Caller checks post access; the SQL enforces comment visibility before selecting a bounded set. */
export function selectCommentRows(actor: PostActor, postId: number, options: { ids?: number[]; limit?: number; visibleOnly?: boolean } = {}): CommentRow[] {
  const limit = Math.max(0, Math.min(100, Math.floor(options.limit ?? 40)));
  if (!limit || options.ids?.length === 0) return [];
  const ids = options.ids ? [...new Set(options.ids)].slice(0, 100).map(validId) : null;
  const visible = visibility(actor, options.visibleOnly);
  return (getUserSettingsDb().prepare(`SELECT * FROM post_comments WHERE post_id = ? AND ${visible.sql}
    ${ids ? `AND id IN (${ids.map(() => '?').join(',')})` : ''} ${ORDER} LIMIT ?`)
    .all(postId, ...visible.params, ...(ids ?? []), limit) as CommentRow[]).reverse();
}

export function selectCommentPage(actor: PostActor, postId: number, input: CommentPageInput = {}) {
  const db = getUserSettingsDb();
  const visible = visibility(actor);
  const parentId = input.parentId === undefined || input.parentId === null ? null : validId(input.parentId);
  let before: PostCommentCursor | null = null;
  if (input.before !== undefined && input.before !== null) {
    const value = input.before as PostCommentCursor;
    if (!value || typeof value.createdAt !== 'string' || value.createdAt.length > 40 || !Number.isFinite(Date.parse(value.createdAt))) throw new PostError('잘못된 댓글 조회 위치야.');
    before = { id: validId(value.id), createdAt: value.createdAt };
  }
  if (input.focusIds !== undefined && (!Array.isArray(input.focusIds) || input.focusIds.length > 3)) throw new PostError('댓글 대상은 3개까지 지정할 수 있어.');
  const focusIds = (input.focusIds as unknown[] | undefined)?.map(validId) ?? [];
  if (parentId !== null) {
    const [parent] = selectCommentRows(actor, postId, { ids: [parentId] });
    if (!parent || parent.parent_id !== null) throw new PostError('댓글 스레드를 찾을 수 없어.', 404);
  }
  // A focused request supplements an already loaded page without reading the latest roots again.
  const rows = focusIds.length ? [] : db.prepare(`SELECT * FROM post_comments WHERE post_id = ? AND parent_id IS ? AND ${visible.sql}
    ${before ? 'AND (created_at, id) < (?, ?)' : ''} ${ORDER} LIMIT ?`)
    .all(postId, parentId, ...visible.params, ...(before ? [before.createdAt, before.id] : []), COMMENT_PAGE_SIZE + 1) as CommentRow[];
  const page = splitPage(rows);
  const selected = new Map(page.rows.map((row) => [row.id, row]));
  const focused = selectCommentRows(actor, postId, { ids: focusIds });
  const ancestors = selectCommentRows(actor, postId, { ids: focused.flatMap((row) => row.parent_id === null ? [row.id] : [row.parent_id]) });
  const parents = new Set(ancestors.map((row) => row.id));
  for (const row of [...ancestors, ...focused]) {
    if (row.parent_id === null || parents.has(row.parent_id)) selected.set(row.id, row);
  }
  const replies: Array<{ parentId: number; nextCursor: PostCommentCursor | null }> = [];
  if (parentId === null) {
    const rootIds = [...selected.values()].filter((row) => row.parent_id === null).map((row) => row.id);
    if (rootIds.length) {
      // One bounded query, each branch using the thread-page index; large sibling sets never load whole bodies.
      const sql = rootIds.map(() => `SELECT * FROM (SELECT * FROM post_comments WHERE post_id = ? AND parent_id = ? AND ${visible.sql} ${ORDER} LIMIT ?)`).join(' UNION ALL ');
      const recent = db.prepare(sql).all(...rootIds.flatMap((id) => [postId, id, ...visible.params, COMMENT_PAGE_SIZE + 1])) as CommentRow[];
      const byParent = new Map<number, CommentRow[]>();
      for (const row of recent) {
        const siblings = byParent.get(row.parent_id!) ?? [];
        siblings.push(row);
        byParent.set(row.parent_id!, siblings);
      }
      for (const id of rootIds) {
        const replyPage = splitPage(byParent.get(id) ?? []);
        for (const row of replyPage.rows) selected.set(row.id, row);
        replies.push({ parentId: id, nextCursor: replyPage.nextCursor });
      }
    }
  }
  // Quotes are context only. Fetch in bounded batches to stay below SQLite's variable limit.
  const quoteIds = [...new Set([...selected.values()].flatMap((row) => row.quote_comment_id && !selected.has(row.quote_comment_id) ? [row.quote_comment_id] : []))];
  const context: CommentRow[] = [];
  for (let offset = 0; offset < quoteIds.length; offset += 100) context.push(...selectCommentRows(actor, postId, { ids: quoteIds.slice(offset, offset + 100), limit: 100 }));
  return { rows: [...selected.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id), context, nextCursor: page.nextCursor, replies };
}
