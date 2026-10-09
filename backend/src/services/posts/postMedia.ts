import { POST_LIMITS, POST_MEDIA_EMBED_PATTERN, type PostMediaKind, type PostMediaRef } from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { fileOwnerKey } from '../fileStoreService';
import { PostError } from './postActor';

const REF_PATTERNS: Record<PostMediaKind, RegExp> = {
  // Library ids: 48 hex (still images, pixel hash) or 32 hex (videos, animated images). An extension may follow.
  media: /^([a-f0-9]{48}|[a-f0-9]{32})(?:\.[a-z0-9]{1,5})?$/i,
  audio: /^[A-Za-z0-9_-]{1,64}$/,
  group: /^[1-9]\d{0,9}$/,
  file: /^[a-f0-9]{32}$/,
};

/** Embedded media in body order, normalized (media refs lose any extension and are lowercased), without repeats. */
export function extractMediaRefs(body: string): PostMediaRef[] {
  const refs: PostMediaRef[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(POST_MEDIA_EMBED_PATTERN)) {
    const kind = match[1] as PostMediaKind;
    const found = REF_PATTERNS[kind].exec(match[2]);
    if (!found) continue;
    const ref = kind === 'media' ? found[1].toLowerCase() : kind === 'file' ? match[2].toLowerCase() : match[2];
    const key = `${kind}:${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind, ref });
  }
  if (refs.length > POST_LIMITS.mediaRefs) throw new PostError(`미디어는 글 하나에 ${POST_LIMITS.mediaRefs}개까지 넣을 수 있어.`);
  return refs;
}

/**
 * Record what a post or comment embeds. File refs must be in the writer's own file store (the account that writes or
 * runs the bot); readers then see them through the post.
 */
export function saveMediaRefs(postId: number, ownerType: 'post' | 'comment', ownerId: number, refs: PostMediaRef[], writerAccountId: number | null) {
  const db = getUserSettingsDb();
  const ownerKey = fileOwnerKey(writerAccountId);
  const fileExists = db.prepare(`SELECT 1 FROM stored_file_entries WHERE id = ? AND owner_key = ? AND kind = 'file' AND deleted_at IS NULL`);
  // A file already embedded by this post or comment keeps its store (an administrator may edit someone else's post).
  const previous = new Map((db.prepare(`SELECT ref, file_owner_key FROM post_media_refs WHERE owner_type = ? AND owner_id = ? AND kind = 'file'`)
    .all(ownerType, ownerId) as Array<{ ref: string; file_owner_key: string }>).map((row) => [row.ref, row.file_owner_key]));
  db.prepare('DELETE FROM post_media_refs WHERE owner_type = ? AND owner_id = ?').run(ownerType, ownerId);
  const insert = db.prepare(`INSERT INTO post_media_refs (post_id, owner_type, owner_id, kind, ref, position, file_owner_key) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  refs.forEach((item, position) => {
    let fileOwner: string | null = null;
    if (item.kind === 'file') {
      fileOwner = previous.get(item.ref) ?? ownerKey;
      if (!fileExists.get(item.ref, fileOwner)) throw new PostError(`보관함에 없는 파일이야: ${item.ref}`, 404);
    }
    insert.run(postId, ownerType, ownerId, item.kind, item.ref, position, fileOwner);
  });
}

/** Plain text of a markdown body for excerpts and search: embeds, images, links and markup removed. */
export function markdownToPlainText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(POST_MEDIA_EMBED_PATTERN, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    // Table separator rows (| --- | :-: |) and horizontal rules carry no text.
    .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+(?:\s*:?-+:?\s*)?$/gm, ' ')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~`|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function excerptOf(body: string, length = 160) {
  const text = markdownToPlainText(body);
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}
