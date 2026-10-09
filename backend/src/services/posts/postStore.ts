import {
  POST_LIMITS,
  type PostAuthor,
  type PostCategory,
  type PostComment,
  type PostCommentMode,
  type PostDetail,
  type PostListResult,
  type PostMediaRef,
  type PostStatus,
  type PostSummary,
  type PostTag,
} from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { AuthAccount } from '../../models/AuthAccount';
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus';
import { ChatProfileStore } from '../codex-chat/chatProfiles';
import { isProfileAssetHidden } from '../codex-chat/chatProfileAssets';
import { PostError, requireKey, type PostActor } from './postActor';
import { excerptOf, extractMediaRefs, saveMediaRefs } from './postMedia';
import { loadPostsSettings } from './postsSettings';
import { removePostSearchDocument, postSearchFilter, refreshPostSearchIndex, writePostSearchDocument } from './postSearch';

type CategoryRow = { id: number; parent_id: number | null; name: string; name_key: string; description: string; sort_order: number };
export type PostRow = {
  id: number; category_id: number | null; title: string; body: string; excerpt: string; status: PostStatus;
  author_type: 'account' | 'profile'; author_profile_id: number | null; author_name: string; owner_account_id: number | null;
  source: string; comment_mode: PostCommentMode; pinned: number; revision: number; comment_count: number;
  published_at: string | null; created_at: string; updated_at: string;
};
export type CommentRow = {
  id: number; post_id: number; parent_id: number | null; quote_comment_id: number | null; author_type: 'account' | 'profile';
  author_profile_id: number | null; author_name: string; owner_account_id: number | null; body: string; mentions: string;
  status: 'visible' | 'hidden' | 'deleted'; bot_run_id: number | null; revision: number; created_at: string; updated_at: string;
};

const MAX_REVISIONS = 20;
export const iso = (value: string | null) => (value ? `${value.replace(' ', 'T')}${value.endsWith('Z') ? '' : 'Z'}` : null);
const db = () => getUserSettingsDb();

function announce(postId: number, kind: 'post' | 'comment' | 'run') {
  publishRuntimeEvent({ name: 'posts.changed', topic: 'posts', visibility: 'all', payload: { postId, kind } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Authors

/** Names and avatars resolved once per response; deleted profiles and accounts fall back to the saved name. */
export function createAuthorResolver(actor: PostActor) {
  const canSeeImages = actor.isAdmin || actor.keys.has('images.view');
  const profiles = new Map<number, ReturnType<typeof ChatProfileStore.find>>();
  const accounts = new Map<number, string | null>();
  const profile = (id: number) => {
    if (!profiles.has(id)) profiles.set(id, ChatProfileStore.find(id));
    return profiles.get(id) ?? null;
  };
  const accountName = (id: number) => {
    if (!accounts.has(id)) {
      let name: string | null = null;
      try { name = AuthAccount.findById(id)?.username ?? null; } catch { /* auth.db not open (tests, bootstrap) */ }
      accounts.set(id, name);
    }
    return accounts.get(id) ?? null;
  };
  return (row: { author_type: 'account' | 'profile'; author_profile_id: number | null; author_name: string; owner_account_id: number | null }): PostAuthor => {
    if (row.author_type === 'profile' && row.author_profile_id !== null) {
      const found = profile(row.author_profile_id);
      const avatarHash = found?.avatarHash ?? null;
      return {
        type: 'profile', accountId: row.owner_account_id, profileId: row.author_profile_id, name: found?.name ?? row.author_name,
        avatarUrl: canSeeImages && avatarHash && !isProfileAssetHidden(avatarHash) ? `/api/images/${avatarHash}/thumbnail` : null,
        avatarCrop: found?.avatarCrop ?? null,
      };
    }
    return { type: 'account', accountId: row.owner_account_id, profileId: null, name: (row.owner_account_id !== null ? accountName(row.owner_account_id) : null) ?? row.author_name, avatarUrl: null, avatarCrop: null };
  };
}

/** The name saved with a post or comment, so it still reads after the profile or account is gone. */
function authorSnapshot(actor: PostActor): { type: 'account' | 'profile'; profileId: number | null; name: string } {
  if (actor.profileId !== null) {
    const profile = ChatProfileStore.find(actor.profileId);
    if (!profile) throw new PostError('채팅 프로필을 찾을 수 없어.', 404);
    return { type: 'profile', profileId: profile.id, name: profile.name };
  }
  let name: string | null = null;
  if (actor.accountId !== null) { try { name = AuthAccount.findById(actor.accountId)?.username ?? null; } catch { /* auth.db not open */ } }
  return { type: 'account', profileId: null, name: name ?? (actor.accountId === null ? 'owner' : `#${actor.accountId}`) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Access

export function canSeePost(actor: PostActor, row: Pick<PostRow, 'status' | 'owner_account_id'>) {
  return actor.isAdmin || row.status === 'published' || (actor.accountId !== null && row.owner_account_id === actor.accountId);
}

/** People edit what their account owns; a bot edits only its own posts within the account it runs as. */
export function canEditPost(actor: PostActor, row: Pick<PostRow, 'owner_account_id' | 'author_profile_id'>) {
  if (actor.isAdmin && actor.profileId === null) return true;
  if (!actor.keys.has('posts.write') && !actor.isAdmin) return false;
  if (row.owner_account_id !== actor.accountId) return false;
  return actor.profileId === null || row.author_profile_id === actor.profileId;
}

function canEditComment(actor: PostActor, row: Pick<CommentRow, 'owner_account_id' | 'author_type' | 'author_profile_id'>) {
  if (actor.isAdmin && actor.profileId === null) return true;
  if (row.owner_account_id !== actor.accountId) return false;
  return actor.profileId === null ? row.author_type === 'account' : row.author_profile_id === actor.profileId;
}

export function requirePostRow(actor: PostActor, postId: number): PostRow {
  if (!Number.isSafeInteger(postId) || postId < 1) throw new PostError('잘못된 게시물 ID야.');
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(postId) as PostRow | undefined;
  if (!row || !canSeePost(actor, row)) throw new PostError('게시물을 찾을 수 없어.', 404);
  return row;
}

// ---------------------------------------------------------------------------------------------------------------------
// Categories (administrators manage them)

function toCategory(row: CategoryRow & { post_count: number }): PostCategory {
  return { id: row.id, parentId: row.parent_id, name: row.name, description: row.description, sortOrder: row.sort_order, postCount: row.post_count };
}

function categoryName(value: unknown) {
  const name = typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > POST_LIMITS.categoryName) throw new PostError(`카테고리 이름은 1~${POST_LIMITS.categoryName}자로 입력해줘.`);
  return name;
}

function categoryAncestors(id: number | null): number[] {
  const chain: number[] = [];
  const parentOf = db().prepare('SELECT parent_id FROM post_categories WHERE id = ?');
  for (let current = id; current !== null; ) {
    if (chain.includes(current) || chain.length > POST_LIMITS.categoryDepth + 1) throw new PostError('카테고리 관계가 순환해.');
    chain.push(current);
    const row = parentOf.get(current) as { parent_id: number | null } | undefined;
    if (!row) throw new PostError('카테고리를 찾을 수 없어.', 404);
    current = row.parent_id;
  }
  return chain;
}

function subtreeHeight(id: number): number {
  const row = db().prepare(`WITH RECURSIVE tree(id, depth) AS (
    SELECT ?, 1 UNION ALL SELECT c.id, tree.depth + 1 FROM post_categories c JOIN tree ON c.parent_id = tree.id WHERE tree.depth < 64
  ) SELECT MAX(depth) AS depth FROM tree`).get(id) as { depth: number };
  return row.depth;
}

/** The category and every category below it. */
export function categoryWithDescendants(id: number): number[] {
  return (db().prepare(`WITH RECURSIVE tree(id, depth) AS (
    SELECT ?, 0 UNION ALL SELECT c.id, tree.depth + 1 FROM post_categories c JOIN tree ON c.parent_id = tree.id WHERE tree.depth < 64
  ) SELECT id FROM tree`).all(id) as Array<{ id: number }>).map((row) => row.id);
}

function parseCategoryId(value: unknown, nullable = true): number | null {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new PostError('잘못된 카테고리 ID야.');
  if (!db().prepare('SELECT 1 FROM post_categories WHERE id = ?').get(id)) throw new PostError('카테고리를 찾을 수 없어.', 404);
  return id;
}

export const PostCategoryStore = {
  list(): PostCategory[] {
    return (db().prepare(`SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'published') AS post_count
      FROM post_categories c ORDER BY c.sort_order, c.name_key, c.id`).all() as Array<CategoryRow & { post_count: number }>).map(toCategory);
  },

  create(actor: PostActor, input: { name?: unknown; parentId?: unknown; description?: unknown; sortOrder?: unknown }): PostCategory {
    if (!actor.isAdmin || actor.profileId !== null) throw new PostError('카테고리는 관리자만 만들 수 있어.', 403);
    const name = categoryName(input.name);
    const parentId = parseCategoryId(input.parentId);
    if (parentId !== null && categoryAncestors(parentId).length >= POST_LIMITS.categoryDepth) throw new PostError(`카테고리는 ${POST_LIMITS.categoryDepth}단계까지 만들 수 있어.`);
    const description = typeof input.description === 'string' ? input.description.trim().slice(0, 500) : '';
    const sortOrder = Number.isSafeInteger(input.sortOrder) ? Number(input.sortOrder) : 0;
    try {
      const result = db().prepare('INSERT INTO post_categories (parent_id, name, name_key, description, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(parentId, name, name.toLowerCase(), description, sortOrder);
      return PostCategoryStore.list().find((category) => category.id === Number(result.lastInsertRowid)) as PostCategory;
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new PostError(`같은 이름의 카테고리가 있어: ${name}`, 409);
      throw error;
    }
  },

  update(actor: PostActor, id: number, input: { name?: unknown; parentId?: unknown; description?: unknown; sortOrder?: unknown }): PostCategory {
    if (!actor.isAdmin || actor.profileId !== null) throw new PostError('카테고리는 관리자만 고칠 수 있어.', 403);
    const current = db().prepare('SELECT * FROM post_categories WHERE id = ?').get(id) as CategoryRow | undefined;
    if (!current) throw new PostError('카테고리를 찾을 수 없어.', 404);
    const name = input.name === undefined ? current.name : categoryName(input.name);
    const parentId = input.parentId === undefined ? current.parent_id : parseCategoryId(input.parentId);
    if (parentId !== current.parent_id && parentId !== null) {
      const ancestors = categoryAncestors(parentId);
      if (ancestors.includes(id)) throw new PostError('카테고리를 자기 아래로 옮길 수 없어.');
      if (ancestors.length + subtreeHeight(id) > POST_LIMITS.categoryDepth) throw new PostError(`카테고리는 ${POST_LIMITS.categoryDepth}단계까지 만들 수 있어.`);
    }
    const description = typeof input.description === 'string' ? input.description.trim().slice(0, 500) : current.description;
    const sortOrder = Number.isSafeInteger(input.sortOrder) ? Number(input.sortOrder) : current.sort_order;
    try {
      db().prepare('UPDATE post_categories SET parent_id = ?, name = ?, name_key = ?, description = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(parentId, name, name.toLowerCase(), description, sortOrder, id);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new PostError(`같은 이름의 카테고리가 있어: ${name}`, 409);
      throw error;
    }
    return PostCategoryStore.list().find((category) => category.id === id) as PostCategory;
  },

  /** Only empty categories: no posts (any status) and no child categories. */
  remove(actor: PostActor, id: number) {
    if (!actor.isAdmin || actor.profileId !== null) throw new PostError('카테고리는 관리자만 지울 수 있어.', 403);
    if (!db().prepare('SELECT 1 FROM post_categories WHERE id = ?').get(id)) throw new PostError('카테고리를 찾을 수 없어.', 404);
    if (db().prepare('SELECT 1 FROM post_categories WHERE parent_id = ?').get(id)) throw new PostError('하위 카테고리를 먼저 옮기거나 지워줘.', 409);
    if (db().prepare('SELECT 1 FROM posts WHERE category_id = ?').get(id)) throw new PostError('카테고리에 글이 있어. 글을 옮긴 다음 지워줘.', 409);
    db().prepare('DELETE FROM post_categories WHERE id = ?').run(id);
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Tags

export function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!raw) throw new PostError('태그는 목록으로 보내줘.');
  const tags: string[] = [];
  const keys = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = item.normalize('NFC').replace(/^#+/, '').replace(/\s+/g, ' ').trim();
    if (!tag) continue;
    if (tag.length > POST_LIMITS.tag) throw new PostError(`태그는 ${POST_LIMITS.tag}자까지야: ${tag}`);
    const key = tag.toLowerCase();
    if (keys.has(key)) continue;
    keys.add(key);
    tags.push(tag);
  }
  if (tags.length > POST_LIMITS.tags) throw new PostError(`태그는 ${POST_LIMITS.tags}개까지 붙일 수 있어.`);
  return tags;
}

function saveTags(postId: number, tags: string[]) {
  const database = db();
  database.prepare('DELETE FROM post_tag_links WHERE post_id = ?').run(postId);
  const findTag = database.prepare('SELECT id FROM post_tags WHERE name_key = ?');
  const insertTag = database.prepare('INSERT INTO post_tags (name, name_key) VALUES (?, ?)');
  const link = database.prepare('INSERT INTO post_tag_links (post_id, tag_id, position) VALUES (?, ?, ?)');
  tags.forEach((tag, position) => {
    const key = tag.toLowerCase();
    const found = findTag.get(key) as { id: number } | undefined;
    const tagId = found?.id ?? Number(insertTag.run(tag, key).lastInsertRowid);
    link.run(postId, tagId, position);
  });
  // Tags nobody uses any more disappear from the sidebar.
  database.prepare('DELETE FROM post_tags WHERE id NOT IN (SELECT tag_id FROM post_tag_links)').run();
}

export const PostTagStore = {
  /** Tags of published posts, most used first. */
  list(limit = 200): PostTag[] {
    return (db().prepare(`SELECT t.name, COUNT(*) AS post_count FROM post_tags t
      JOIN post_tag_links l ON l.tag_id = t.id JOIN posts p ON p.id = l.post_id AND p.status = 'published'
      GROUP BY t.id ORDER BY post_count DESC, t.name_key LIMIT ?`).all(Math.max(1, Math.min(1000, limit))) as Array<{ name: string; post_count: number }>)
      .map((row) => ({ name: row.name, postCount: row.post_count }));
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Posts

function postTitle(value: unknown) {
  const title = typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  if (!title || title.length > POST_LIMITS.title) throw new PostError(`제목은 1~${POST_LIMITS.title}자로 입력해줘.`);
  return title;
}

function postBody(value: unknown, limit: number = POST_LIMITS.body) {
  const body = typeof value === 'string' ? value.normalize('NFC').replace(/\r\n?/g, '\n') : '';
  if (body.length > limit) throw new PostError(`본문은 ${limit.toLocaleString('en-US')}자까지야.`);
  return body;
}

function summaries(actor: PostActor, rows: PostRow[]): PostSummary[] {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const marks = ids.map(() => '?').join(',');
  const tags = new Map<number, string[]>();
  for (const row of db().prepare(`SELECT l.post_id, t.name FROM post_tag_links l JOIN post_tags t ON t.id = l.tag_id WHERE l.post_id IN (${marks}) ORDER BY l.post_id, l.position`).all(...ids) as Array<{ post_id: number; name: string }>) {
    tags.set(row.post_id, [...(tags.get(row.post_id) ?? []), row.name]);
  }
  const media = new Map<number, PostMediaRef[]>();
  const counts = new Map<number, number>();
  for (const row of db().prepare(`SELECT post_id, kind, ref FROM post_media_refs WHERE owner_type = 'post' AND post_id IN (${marks}) ORDER BY post_id, position`).all(...ids) as Array<{ post_id: number; kind: PostMediaRef['kind']; ref: string }>) {
    counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
    const list = media.get(row.post_id) ?? [];
    if (list.length < 10) list.push({ kind: row.kind, ref: row.ref });
    media.set(row.post_id, list);
  }
  const author = createAuthorResolver(actor);
  return rows.map((row) => ({
    id: row.id, categoryId: row.category_id, title: row.title, excerpt: row.excerpt, status: row.status, author: author(row),
    tags: tags.get(row.id) ?? [], media: media.get(row.id) ?? [], mediaCount: counts.get(row.id) ?? 0, commentCount: row.comment_count,
    pinned: row.pinned === 1, commentMode: row.comment_mode, revision: row.revision, publishedAt: iso(row.published_at),
    createdAt: iso(row.created_at) as string, updatedAt: iso(row.updated_at) as string, canEdit: canEditPost(actor, row),
  }));
}

export type PostListQuery = {
  categoryId?: unknown; tag?: unknown; q?: unknown; status?: unknown; authorProfileId?: unknown; offset?: unknown; limit?: unknown;
};

export type PostInput = {
  title?: unknown; body?: unknown; categoryId?: unknown; tags?: unknown; status?: unknown; commentMode?: unknown; pinned?: unknown; expectedRevision?: unknown;
};

function statusInput(actor: PostActor, value: unknown, fallback: PostStatus): PostStatus {
  if (value === undefined) return fallback;
  if (value !== 'draft' && value !== 'published' && value !== 'hidden') throw new PostError('상태는 draft, published, hidden 중 하나야.');
  if (value === 'hidden' && !(actor.isAdmin && actor.profileId === null)) throw new PostError('숨김은 관리자만 할 수 있어.', 403);
  return value;
}

export const PostStore = {
  async list(actor: PostActor, query: PostListQuery): Promise<PostListResult> {
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new PostError('잘못된 목록 범위야.');
    const where: string[] = [];
    const params: unknown[] = [];
    const status = query.status === undefined || query.status === '' ? 'published' : String(query.status);
    if (!['published', 'draft', 'hidden', 'all'].includes(status)) throw new PostError('잘못된 상태 필터야.');
    if (status === 'all') {
      if (!actor.isAdmin) { where.push(`(p.status = 'published' OR p.owner_account_id IS ?)`); params.push(actor.accountId); }
    } else {
      where.push('p.status = ?');
      params.push(status);
      // Drafts and hidden posts: your own, or all of them for administrators.
      if (status !== 'published' && !actor.isAdmin) { where.push('p.owner_account_id IS ?'); params.push(actor.accountId); }
    }
    if (query.categoryId !== undefined && query.categoryId !== '') {
      const categoryId = parseCategoryId(query.categoryId, false) as number;
      const ids = categoryWithDescendants(categoryId);
      where.push(`p.category_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    if (typeof query.tag === 'string' && query.tag.trim()) {
      where.push('p.id IN (SELECT l.post_id FROM post_tag_links l JOIN post_tags t ON t.id = l.tag_id WHERE t.name_key = ?)');
      params.push(query.tag.normalize('NFC').replace(/^#+/, '').trim().toLowerCase());
    }
    if (query.authorProfileId !== undefined && query.authorProfileId !== '') {
      where.push('p.author_profile_id = ?');
      params.push(Number(query.authorProfileId));
    }
    if (typeof query.q === 'string' && query.q.trim()) {
      await refreshPostSearchIndex();
      const filter = postSearchFilter(query.q);
      where.push(filter.sql);
      params.push(...filter.params);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = status === 'published' ? 'p.pinned DESC, p.published_at DESC, p.id DESC' : 'p.updated_at DESC, p.id DESC';
    const rows = db().prepare(`SELECT p.* FROM posts p ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset) as PostRow[];
    const { total } = db().prepare(`SELECT COUNT(*) AS total FROM posts p ${clause}`).get(...params) as { total: number };
    return { items: summaries(actor, rows), total, offset, limit };
  },

  get(actor: PostActor, postId: number): PostDetail {
    const row = requirePostRow(actor, postId);
    return { ...summaries(actor, [row])[0], body: row.body };
  },

  /** `source`: manual (web), chat (a bot tool), routine, workflow, mention. */
  create(actor: PostActor, input: PostInput, source = 'manual'): PostDetail {
    requireKey(actor, 'posts.write');
    const title = postTitle(input.title);
    const body = postBody(input.body);
    const categoryId = parseCategoryId(input.categoryId);
    const tags = normalizeTags(input.tags);
    const fallback: PostStatus = actor.profileId !== null ? loadPostsSettings().botPostStatus : 'published';
    let status = statusInput(actor, input.status, fallback);
    // A bot asked to publish still waits for review when the settings say so.
    if (actor.profileId !== null && status === 'published' && loadPostsSettings().botPostStatus === 'draft') status = 'draft';
    const commentMode: PostCommentMode = input.commentMode === 'closed' ? 'closed' : 'open';
    const pinned = input.pinned === true && actor.isAdmin && actor.profileId === null ? 1 : 0;
    const author = authorSnapshot(actor);
    const refs = extractMediaRefs(body);
    const postId = db().transaction(() => {
      const result = db().prepare(`INSERT INTO posts (category_id, title, body, excerpt, status, author_type, author_profile_id, author_name, owner_account_id, source, comment_mode, pinned, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP END)`)
        .run(categoryId, title, body, excerptOf(body), status, author.type, author.profileId, author.name, actor.accountId, source, commentMode, pinned, status);
      const id = Number(result.lastInsertRowid);
      saveTags(id, tags);
      saveMediaRefs(id, 'post', id, refs, actor.accountId);
      writePostSearchDocument(id);
      return id;
    }).immediate();
    announce(postId, 'post');
    return PostStore.get(actor, postId);
  },

  /** Fields left undefined stay. `expectedRevision` (when given) must match, or the edit is refused with 409. */
  update(actor: PostActor, postId: number, input: PostInput): PostDetail {
    const updated = db().transaction(() => {
      const row = requirePostRow(actor, postId);
      if (!canEditPost(actor, row)) throw new PostError('이 글을 고칠 권한이 없어.', 403);
      if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== row.revision) {
        throw new PostError(`다른 곳에서 먼저 고쳤어 (현재 판 ${row.revision}). 새로 불러온 다음 다시 고쳐줘.`, 409);
      }
      const title = input.title === undefined ? row.title : postTitle(input.title);
      const body = input.body === undefined ? row.body : postBody(input.body);
      const categoryId = input.categoryId === undefined ? row.category_id : parseCategoryId(input.categoryId);
      const status = statusInput(actor, input.status, row.status);
      if (row.status === 'hidden' && status !== 'hidden' && !(actor.isAdmin && actor.profileId === null)) throw new PostError('숨긴 글은 관리자만 다시 보이게 할 수 있어.', 403);
      const commentMode: PostCommentMode = input.commentMode === undefined ? row.comment_mode : input.commentMode === 'closed' ? 'closed' : 'open';
      const pinned = input.pinned === undefined || !(actor.isAdmin && actor.profileId === null) ? row.pinned : input.pinned === true ? 1 : 0;
      const contentChanged = title !== row.title || body !== row.body;
      if (contentChanged) {
        const editor = authorSnapshot(actor);
        db().prepare(`INSERT OR REPLACE INTO post_revisions (post_id, revision, title, body, edited_by_type, edited_by_account_id, edited_by_profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(postId, row.revision, row.title, row.body, editor.type, actor.accountId, editor.profileId);
        db().prepare(`DELETE FROM post_revisions WHERE post_id = ? AND revision NOT IN (SELECT revision FROM post_revisions WHERE post_id = ? ORDER BY revision DESC LIMIT ${MAX_REVISIONS})`).run(postId, postId);
      }
      db().prepare(`UPDATE posts SET title = ?, body = ?, excerpt = ?, category_id = ?, status = ?, comment_mode = ?, pinned = ?,
          revision = revision + 1, updated_at = CURRENT_TIMESTAMP,
          published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN CURRENT_TIMESTAMP ELSE published_at END
        WHERE id = ?`).run(title, body, excerptOf(body), categoryId, status, commentMode, pinned, status, postId);
      if (input.tags !== undefined) saveTags(postId, normalizeTags(input.tags));
      if (body !== row.body) saveMediaRefs(postId, 'post', postId, extractMediaRefs(body), row.owner_account_id);
      writePostSearchDocument(postId);
      return postId;
    }).immediate();
    announce(updated, 'post');
    return PostStore.get(actor, updated);
  },

  remove(actor: PostActor, postId: number) {
    db().transaction(() => {
      const row = requirePostRow(actor, postId);
      if (!canEditPost(actor, row)) throw new PostError('이 글을 지울 권한이 없어.', 403);
      db().prepare('DELETE FROM posts WHERE id = ?').run(postId);
      removePostSearchDocument(postId);
    }).immediate();
    announce(postId, 'post');
  },

  revisions(actor: PostActor, postId: number) {
    const row = requirePostRow(actor, postId);
    if (!canEditPost(actor, row)) throw new PostError('이 글의 이전 판을 볼 권한이 없어.', 403);
    return (db().prepare('SELECT revision, title, body, edited_by_type, edited_by_account_id, edited_by_profile_id, created_at FROM post_revisions WHERE post_id = ? ORDER BY revision DESC').all(postId) as Array<{
      revision: number; title: string; body: string; edited_by_type: string; edited_by_account_id: number | null; edited_by_profile_id: number | null; created_at: string;
    }>).map((item) => ({ revision: item.revision, title: item.title, body: item.body, editedByType: item.edited_by_type, editedByAccountId: item.edited_by_account_id, editedByProfileId: item.edited_by_profile_id, createdAt: iso(item.created_at) }));
  },

  /** The store whose file a post (or one of its comments) embeds, or null when it embeds no such file. */
  embeddedFileOwner(actor: PostActor, postId: number, fileId: string): string | null {
    requirePostRow(actor, postId);
    const row = db().prepare(`SELECT r.file_owner_key FROM post_media_refs r
      LEFT JOIN post_comments c ON r.owner_type = 'comment' AND c.id = r.owner_id
      WHERE r.post_id = ? AND r.kind = 'file' AND r.ref = ? AND (r.owner_type = 'post' OR c.status = 'visible' OR ?) LIMIT 1`)
      .get(postId, fileId, actor.isAdmin ? 1 : 0) as { file_owner_key: string } | undefined;
    return row?.file_owner_key ?? null;
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Comments

type CommentListener = (comment: CommentRow, actor: PostActor, post: PostRow) => void;
const commentListeners = new Set<CommentListener>();

function toComment(actor: PostActor, row: CommentRow, author: ReturnType<typeof createAuthorResolver>): PostComment {
  const visibleBody = row.status === 'deleted' || (row.status === 'hidden' && !actor.isAdmin && row.owner_account_id !== actor.accountId) ? '' : row.body;
  let mentions: number[] = [];
  try { mentions = (JSON.parse(row.mentions) as unknown[]).filter((id): id is number => Number.isSafeInteger(id)); } catch { /* none */ }
  return {
    id: row.id, postId: row.post_id, parentId: row.parent_id, quoteCommentId: row.quote_comment_id, author: author(row), body: visibleBody,
    mentions, status: row.status, botRunId: row.bot_run_id, revision: row.revision, createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string, canEdit: row.status !== 'deleted' && canEditComment(actor, row),
  };
}

function refreshCommentCount(postId: number) {
  db().prepare(`UPDATE posts SET comment_count = (SELECT COUNT(*) FROM post_comments WHERE post_id = ? AND status = 'visible') WHERE id = ?`).run(postId, postId);
}

export type CommentInput = { body?: unknown; parentId?: unknown; mentions?: unknown; expectedRevision?: unknown };

export const PostCommentStore = {
  /** Hear about every new comment (the bot caller uses it). A failing listener never fails the comment. */
  onCreated(listener: CommentListener) {
    commentListeners.add(listener);
    return () => { commentListeners.delete(listener); };
  },

  list(actor: PostActor, postId: number): PostComment[] {
    requirePostRow(actor, postId);
    const rows = db().prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at, id').all(postId) as CommentRow[];
    const author = createAuthorResolver(actor);
    // A hidden comment shows only to administrators and its writer; others see the thread around it.
    return rows
      .filter((row) => row.status !== 'hidden' || actor.isAdmin || row.owner_account_id === actor.accountId)
      .map((row) => toComment(actor, row, author));
  },

  get(actor: PostActor, commentId: number): PostComment {
    const row = db().prepare('SELECT * FROM post_comments WHERE id = ?').get(commentId) as CommentRow | undefined;
    if (!row) throw new PostError('댓글을 찾을 수 없어.', 404);
    requirePostRow(actor, row.post_id);
    return toComment(actor, row, createAuthorResolver(actor));
  },

  /**
   * Answering a reply attaches to its top-level comment and quotes the reply (comments are two levels deep).
   * `mentions` are profile ids the writer picked; the bot caller decides which of them actually run.
   */
  create(actor: PostActor, postId: number, input: CommentInput, options: { botRunId?: number | null } = {}): PostComment {
    requireKey(actor, 'posts.comment');
    const body = postBody(input.body, POST_LIMITS.comment).trim();
    if (!body) throw new PostError('댓글 내용을 입력해줘.');
    const mentions = Array.isArray(input.mentions) ? [...new Set(input.mentions.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 20) : [];
    const refs = extractMediaRefs(body);
    const created = db().transaction(() => {
      const post = requirePostRow(actor, postId);
      if (post.status !== 'published' && !(actor.isAdmin || post.owner_account_id === actor.accountId)) throw new PostError('발행된 글에만 댓글을 달 수 있어.', 403);
      if (post.comment_mode === 'closed' && !(actor.isAdmin && actor.profileId === null)) throw new PostError('댓글이 닫힌 글이야.', 403);
      let parentId: number | null = null;
      let quoteId: number | null = null;
      if (input.parentId !== undefined && input.parentId !== null && input.parentId !== '') {
        const parent = db().prepare('SELECT id, parent_id FROM post_comments WHERE id = ? AND post_id = ?').get(Number(input.parentId), postId) as { id: number; parent_id: number | null } | undefined;
        if (!parent) throw new PostError('답글을 달 댓글을 찾을 수 없어.', 404);
        parentId = parent.parent_id ?? parent.id;
        quoteId = parent.parent_id === null ? null : parent.id;
      }
      const author = authorSnapshot(actor);
      const result = db().prepare(`INSERT INTO post_comments (post_id, parent_id, quote_comment_id, author_type, author_profile_id, author_name, owner_account_id, body, mentions, bot_run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(postId, parentId, quoteId, author.type, author.profileId, author.name, actor.accountId, body, JSON.stringify(mentions), options.botRunId ?? null);
      const id = Number(result.lastInsertRowid);
      saveMediaRefs(postId, 'comment', id, refs, actor.accountId);
      refreshCommentCount(postId);
      return { row: db().prepare('SELECT * FROM post_comments WHERE id = ?').get(id) as CommentRow, post };
    }).immediate();
    announce(postId, 'comment');
    for (const listener of commentListeners) {
      try { listener(created.row, actor, created.post); }
      catch (error) { console.warn('[posts] Comment listener failed:', error instanceof Error ? error.message : error); }
    }
    return toComment(actor, created.row, createAuthorResolver(actor));
  },

  update(actor: PostActor, commentId: number, input: CommentInput): PostComment {
    const row = db().transaction(() => {
      const current = db().prepare('SELECT * FROM post_comments WHERE id = ?').get(commentId) as CommentRow | undefined;
      if (!current) throw new PostError('댓글을 찾을 수 없어.', 404);
      requirePostRow(actor, current.post_id);
      if (current.status === 'deleted' || !canEditComment(actor, current)) throw new PostError('이 댓글을 고칠 권한이 없어.', 403);
      if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== current.revision) throw new PostError('다른 곳에서 먼저 고쳤어. 새로 불러온 다음 다시 고쳐줘.', 409);
      const body = postBody(input.body, POST_LIMITS.comment).trim();
      if (!body) throw new PostError('댓글 내용을 입력해줘.');
      db().prepare('UPDATE post_comments SET body = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(body, commentId);
      saveMediaRefs(current.post_id, 'comment', commentId, extractMediaRefs(body), current.owner_account_id);
      return db().prepare('SELECT * FROM post_comments WHERE id = ?').get(commentId) as CommentRow;
    }).immediate();
    announce(row.post_id, 'comment');
    return toComment(actor, row, createAuthorResolver(actor));
  },

  /** A comment with replies keeps its place as "deleted"; one without is removed. */
  remove(actor: PostActor, commentId: number) {
    const postId = db().transaction(() => {
      const current = db().prepare('SELECT * FROM post_comments WHERE id = ?').get(commentId) as CommentRow | undefined;
      if (!current) throw new PostError('댓글을 찾을 수 없어.', 404);
      requirePostRow(actor, current.post_id);
      if (!canEditComment(actor, current)) throw new PostError('이 댓글을 지울 권한이 없어.', 403);
      db().prepare(`DELETE FROM post_media_refs WHERE owner_type = 'comment' AND owner_id = ?`).run(commentId);
      if (db().prepare('SELECT 1 FROM post_comments WHERE parent_id = ?').get(commentId)) {
        db().prepare(`UPDATE post_comments SET status = 'deleted', body = '', mentions = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(commentId);
      } else {
        db().prepare('DELETE FROM post_comments WHERE id = ?').run(commentId);
      }
      refreshCommentCount(current.post_id);
      return current.post_id;
    }).immediate();
    announce(postId, 'comment');
  },

  /** Administrators hide a comment from everyone but its writer, or show it again. */
  setHidden(actor: PostActor, commentId: number, hidden: boolean): PostComment {
    if (!actor.isAdmin || actor.profileId !== null) throw new PostError('댓글 숨김은 관리자만 할 수 있어.', 403);
    const current = db().prepare('SELECT * FROM post_comments WHERE id = ?').get(commentId) as CommentRow | undefined;
    if (!current || current.status === 'deleted') throw new PostError('댓글을 찾을 수 없어.', 404);
    db().prepare('UPDATE post_comments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hidden ? 'hidden' : 'visible', commentId);
    refreshCommentCount(current.post_id);
    announce(current.post_id, 'comment');
    return PostCommentStore.get(actor, commentId);
  },
};

export { announce as announcePostChange };
