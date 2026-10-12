import { getUserSettingsDb } from '../../database/userSettingsDb';
import { parseSearchTerms } from '../fileStoreSearch';
import { markdownToPlainText } from './postMedia';

/**
 * Posts in search.db (`source = 'post'`): title, tags and the body's plain text, at the post's revision; and their
 * visible comments (`source = 'post_comment'`, the comment's plain text at its revision). Saves keep posts current;
 * `refreshPostSearchIndex` fills in what the index lacks (search.db recreated, posts from before, new comments) and
 * drops comments no longer shown.
 */
function documentOf(postId: number): { revision: string; body: string } | null {
  const db = getUserSettingsDb();
  const post = db.prepare('SELECT title, body, revision FROM posts WHERE id = ?').get(postId) as { title: string; body: string; revision: number } | undefined;
  if (!post || db.prepare('SELECT 1 FROM post_knowledge WHERE post_id = ? AND deleted_at IS NOT NULL').get(postId)) return null;
  const tags = (db.prepare('SELECT t.name FROM post_tag_links l JOIN post_tags t ON t.id = l.tag_id WHERE l.post_id = ? ORDER BY l.position').all(postId) as Array<{ name: string }>).map((row) => `#${row.name}`);
  const aliases = (db.prepare('SELECT name FROM post_aliases WHERE post_id = ? ORDER BY name_key').all(postId) as Array<{ name: string }>).map(row => row.name);
  return { revision: String(post.revision), body: [post.title, aliases.join(' '), tags.join(' '), markdownToPlainText(post.body)].filter(Boolean).join('\n') };
}

export function writePostSearchDocument(postId: number) {
  const document = documentOf(postId);
  if (!document) return;
  getUserSettingsDb().prepare(`INSERT INTO search_db.search_documents (source, source_id, owner_key, revision, body) VALUES ('post', ?, NULL, ?, ?)
    ON CONFLICT(source, source_id) DO UPDATE SET revision = excluded.revision, body = excluded.body`).run(String(postId), document.revision, document.body);
}

/** Call before the post row goes (its comments go with it): the post's text and its comments' leave the index. */
export function removePostSearchDocument(postId: number) {
  const db = getUserSettingsDb();
  db.prepare(`DELETE FROM search_db.search_documents WHERE source = 'post' AND source_id = ?`).run(String(postId));
  db.prepare(`DELETE FROM search_db.search_documents WHERE source = 'post_comment' AND source_id IN (SELECT CAST(id AS TEXT) FROM post_comments WHERE post_id = ?)`).run(postId);
}

export async function refreshPostSearchIndex() {
  const db = getUserSettingsDb();
  const stale = db.prepare(`SELECT p.id FROM posts p LEFT JOIN search_db.search_documents d ON d.source = 'post' AND d.source_id = CAST(p.id AS TEXT)
    WHERE NOT EXISTS(SELECT 1 FROM post_knowledge k WHERE k.post_id=p.id AND k.deleted_at IS NOT NULL)
      AND (d.source_id IS NULL OR d.revision <> CAST(p.revision AS TEXT)) LIMIT 5000`).all() as Array<{ id: number }>;
  if (stale.length) db.transaction(() => stale.forEach((row) => writePostSearchDocument(row.id)))();
  db.prepare(`DELETE FROM search_db.search_documents WHERE source = 'post' AND CAST(source_id AS INTEGER) NOT IN (SELECT p.id FROM posts p WHERE NOT EXISTS(SELECT 1 FROM post_knowledge k WHERE k.post_id=p.id AND k.deleted_at IS NOT NULL))`).run();

  const staleComments = db.prepare(`SELECT c.id, c.body, c.revision FROM post_comments c
    LEFT JOIN search_db.search_documents d ON d.source = 'post_comment' AND d.source_id = CAST(c.id AS TEXT)
    WHERE c.status = 'visible' AND NOT EXISTS(SELECT 1 FROM post_knowledge k WHERE k.post_id=c.post_id AND k.deleted_at IS NOT NULL)
      AND (d.source_id IS NULL OR d.revision <> CAST(c.revision AS TEXT)) LIMIT 5000`).all() as Array<{ id: number; body: string; revision: number }>;
  if (staleComments.length) {
    const write = db.prepare(`INSERT INTO search_db.search_documents (source, source_id, owner_key, revision, body) VALUES ('post_comment', ?, NULL, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET revision = excluded.revision, body = excluded.body`);
    db.transaction(() => staleComments.forEach((row) => write.run(String(row.id), String(row.revision), markdownToPlainText(row.body))))();
  }
  // Hidden, deleted and removed comments leave the index (they come back when shown again).
  db.prepare(`DELETE FROM search_db.search_documents WHERE source = 'post_comment' AND CAST(source_id AS INTEGER) NOT IN (SELECT c.id FROM post_comments c WHERE c.status = 'visible' AND NOT EXISTS(SELECT 1 FROM post_knowledge k WHERE k.post_id=c.post_id AND k.deleted_at IS NOT NULL))`).run();
}

const matchesAll = (terms: string[], column = 'body') => terms.map(() => `instr(lower(${column}), ?) > 0`).join(' AND ');

/**
 * A WHERE fragment on `p.id` matching posts that contain every term (same rules as the file search), in the post itself
 * or within one of its visible comments.
 */
export function postSearchFilter(query: unknown): { sql: string; params: string[]; terms: string[] } {
  const terms = parseSearchTerms(query);
  return {
    sql: `(p.id IN (SELECT CAST(source_id AS INTEGER) FROM search_db.search_documents WHERE source = 'post' AND ${matchesAll(terms)})
      OR p.id IN (SELECT c.post_id FROM post_comments c JOIN search_db.search_documents d ON d.source = 'post_comment' AND d.source_id = CAST(c.id AS TEXT)
        WHERE c.status = 'visible' AND ${matchesAll(terms, 'd.body')}))`,
    params: [...terms, ...terms],
    terms,
  };
}

/** Trash is deliberately absent from the derived index; owners search its retained original records. */
export function trashPostSearchFilter(query:unknown) {
  const terms=parseSearchTerms(query);
  const own=terms.map(()=>`(instr(lower(p.title||' '||p.body),?)>0
    OR EXISTS(SELECT 1 FROM post_aliases a WHERE a.post_id=p.id AND instr(a.name_key,?)>0)
    OR EXISTS(SELECT 1 FROM post_tag_links l JOIN post_tags t ON t.id=l.tag_id WHERE l.post_id=p.id AND instr(lower('#'||t.name),?)>0))`).join(' AND ');
  return {sql:`((${own}) OR EXISTS(SELECT 1 FROM post_comments c WHERE c.post_id=p.id AND c.status='visible' AND ${matchesAll(terms,'c.body')}))`,
    params:[...terms.flatMap(term=>[term,term,term]),...terms],terms};
}

/** A short piece of `text` around the first term, for showing why it matched. */
function snippet(text: string, terms: string[], length = 90) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = Math.max(0, ...[flat.toLowerCase().indexOf(terms[0] ?? '')].filter((index) => index >= 0));
  const start = Math.max(0, at - 20);
  const piece = flat.slice(start, start + length);
  return `${start > 0 ? '…' : ''}${piece}${start + length < flat.length ? '…' : ''}`;
}

/**
 * Of these posts, the ones that matched only through a comment: that comment (the first one), with its writer and the
 * piece of text that matched.
 */
export function commentMatches(postIds: number[], terms: string[]): Map<number, { id: number; author: string; excerpt: string }> {
  const found = new Map<number, { id: number; author: string; excerpt: string }>();
  if (!postIds.length || !terms.length) return found;
  const db = getUserSettingsDb();
  const marks = postIds.map(() => '?').join(',');
  const ownMatches = new Set((db.prepare(`SELECT CAST(source_id AS INTEGER) AS id FROM search_db.search_documents WHERE source = 'post' AND source_id IN (${marks}) AND ${matchesAll(terms)}`)
    .all(...postIds.map(String), ...terms) as Array<{ id: number }>).map((row) => row.id));
  const rest = postIds.filter((id) => !ownMatches.has(id));
  if (!rest.length) return found;
  const rows = db.prepare(`SELECT c.id, c.post_id, c.author_name, d.body FROM post_comments c
      JOIN search_db.search_documents d ON d.source = 'post_comment' AND d.source_id = CAST(c.id AS TEXT)
    WHERE c.post_id IN (${rest.map(() => '?').join(',')}) AND c.status = 'visible' AND ${matchesAll(terms, 'd.body')} ORDER BY c.id`)
    .all(...rest, ...terms) as Array<{ id: number; post_id: number; author_name: string; body: string }>;
  for (const row of rows) {
    if (!found.has(row.post_id)) found.set(row.post_id, { id: row.id, author: row.author_name, excerpt: snippet(row.body, terms) });
  }
  return found;
}

/** Title/alias matches remain discoverable even with a low quality score. */
export function createPostRelevanceResolver(terms:string[],query:string) {
  const aliasesOf=getUserSettingsDb().prepare('SELECT name_key FROM post_aliases WHERE post_id=?');
  const tagsOf=getUserSettingsDb().prepare('SELECT t.name_key FROM post_tag_links l JOIN post_tags t ON t.id=l.tag_id WHERE l.post_id=?');
  const phrase=query.normalize('NFC').trim().toLowerCase();
  return (post:{id:number;title:string;body:string}):number=>{
    if(!terms.length) return 4;
    const title=post.title.toLowerCase();
    if(title===phrase) return 0;
    const aliases=(aliasesOf.all(post.id) as Array<{name_key:string}>).map(row=>row.name_key);
    if(aliases.includes(phrase)) return 0;
    if([title,...aliases].some(value=>terms.every(term=>value.includes(term)))) return 1;
    const tags=(tagsOf.all(post.id) as Array<{name_key:string}>).map(row=>`#${row.name_key}`).join(' ');
    if(terms.every(term=>tags.includes(term))) return 2;
    const body=markdownToPlainText(post.body).toLowerCase();
    return terms.every(term=>body.includes(term))?3:4;
  };
}

export function postRelevanceBand(post:{id:number;title:string;body:string},terms:string[],query:string):number {
  return createPostRelevanceResolver(terms,query)(post);
}
