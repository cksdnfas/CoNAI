import { getUserSettingsDb } from '../../database/userSettingsDb';
import { parseSearchTerms } from '../fileStoreSearch';
import { markdownToPlainText } from './postMedia';

/**
 * Posts in search.db (`source = 'post'`): title, tags and the body's plain text, at the post's revision. Saves keep
 * it current; `refreshPostSearchIndex` fills in posts the index lacks (search.db recreated, posts from before).
 */
function documentOf(postId: number): { revision: string; body: string } | null {
  const db = getUserSettingsDb();
  const post = db.prepare('SELECT title, body, revision FROM posts WHERE id = ?').get(postId) as { title: string; body: string; revision: number } | undefined;
  if (!post) return null;
  const tags = (db.prepare('SELECT t.name FROM post_tag_links l JOIN post_tags t ON t.id = l.tag_id WHERE l.post_id = ? ORDER BY l.position').all(postId) as Array<{ name: string }>).map((row) => `#${row.name}`);
  return { revision: String(post.revision), body: [post.title, tags.join(' '), markdownToPlainText(post.body)].filter(Boolean).join('\n') };
}

export function writePostSearchDocument(postId: number) {
  const document = documentOf(postId);
  if (!document) return;
  getUserSettingsDb().prepare(`INSERT INTO search_db.search_documents (source, source_id, owner_key, revision, body) VALUES ('post', ?, NULL, ?, ?)
    ON CONFLICT(source, source_id) DO UPDATE SET revision = excluded.revision, body = excluded.body`).run(String(postId), document.revision, document.body);
}

export function removePostSearchDocument(postId: number) {
  getUserSettingsDb().prepare(`DELETE FROM search_db.search_documents WHERE source = 'post' AND source_id = ?`).run(String(postId));
}

export async function refreshPostSearchIndex() {
  const db = getUserSettingsDb();
  const stale = db.prepare(`SELECT p.id FROM posts p LEFT JOIN search_db.search_documents d ON d.source = 'post' AND d.source_id = CAST(p.id AS TEXT)
    WHERE d.source_id IS NULL OR d.revision <> CAST(p.revision AS TEXT) LIMIT 5000`).all() as Array<{ id: number }>;
  if (stale.length) db.transaction(() => stale.forEach((row) => writePostSearchDocument(row.id)))();
  db.prepare(`DELETE FROM search_db.search_documents WHERE source = 'post' AND CAST(source_id AS INTEGER) NOT IN (SELECT id FROM posts)`).run();
}

/** A WHERE fragment on `p.id` matching posts that contain every term (same rules as the file search). */
export function postSearchFilter(query: unknown): { sql: string; params: string[] } {
  const terms = parseSearchTerms(query);
  return {
    sql: `p.id IN (SELECT CAST(source_id AS INTEGER) FROM search_db.search_documents WHERE source = 'post' AND ${terms.map(() => 'instr(lower(body), ?) > 0').join(' AND ')})`,
    params: terms,
  };
}
