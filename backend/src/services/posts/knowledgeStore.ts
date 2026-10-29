import { createHash, randomUUID } from 'crypto';
import type { PostKnowledge, PostKnowledgeSource, PostKnowledgeLinks, PostKnowledgeVersion, PostReviewIssue, PostKnowledgeReviewQueue, PostKnowledgeExport, PostDetail, PostKnowledgePermanentDeletePreview, PostKnowledgePermanentDeleteDependency, PostKnowledgePermanentDeleteResult } from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus';
import { PostError, requireKey, requireHumanPostActor, isHumanPostActor, postActorAccountKey, type PostActor } from './postActor';
import { PostStore, canEditPost, canSeePost, type PostRow } from './postStore';
import { loadPostsSettings } from './postsSettings';
import { removePostSearchDocument, writePostSearchDocument } from './postSearch';
import { invalidatePostTopicRequests, onPostTopicWrite, kickPostTopicEvaluationQueue } from './postTopicEvaluation';
import { notifySemanticChange } from '../embeddings/semanticSignal';

const db = () => getUserSettingsDb();
const date = (value: string | null) => value ? (value.includes('T') ? value : `${value.replace(' ', 'T')}Z`) : null;
export type KnowledgeRow = { post_id: number; enabled: number; content_version: number; content_hash: string; review_status: 'unreviewed' | 'verified' | 'needs_review'; verified_content_version: number | null; replacement_post_id: number | null; deleted_at: string | null };
export const findKnowledgeRow = (postId: number) => db().prepare('SELECT * FROM post_knowledge WHERE post_id = ?').get(postId) as KnowledgeRow | undefined;

/** Hydrate a page's knowledge and replacement visibility without reading replacement bodies. */
export function getKnowledgeStates(postIds: number[], actor?: PostActor): Map<number, PostKnowledge> {
  const states = new Map<number, PostKnowledge>();
  if (!postIds.length) return states;
  const rows = db().prepare(`SELECT k.*, p.id AS replacement_id, p.status AS replacement_status,
    p.owner_account_id AS replacement_owner_account_id, replacement.deleted_at AS replacement_deleted_at
    FROM post_knowledge k LEFT JOIN posts p ON p.id=k.replacement_post_id
    LEFT JOIN post_knowledge replacement ON replacement.post_id=p.id
    WHERE k.post_id IN (${postIds.map(() => '?').join(',')})`).all(...postIds) as Array<KnowledgeRow & {
      replacement_id: number | null; replacement_status: PostRow['status'] | null;
      replacement_owner_account_id: number | null; replacement_deleted_at: string | null;
    }>;
  for (const row of rows) {
    let replacementPostId = row.replacement_post_id;
    if (actor && replacementPostId !== null && (row.replacement_id === null || row.replacement_deleted_at
      || !canSeePost(actor, { status: row.replacement_status!, owner_account_id: row.replacement_owner_account_id }))) replacementPostId = null;
    states.set(row.post_id, {
      enabled: row.enabled === 1, contentVersion: row.content_version, contentHash: row.content_hash, reviewStatus: row.review_status,
      verifiedContentVersion: row.verified_content_version, deletedAt: date(row.deleted_at), replacementPostId,
      canEvaluate: Boolean(actor && !row.deleted_at && (actor.isAdmin || actor.keys.has('posts.evaluate'))),
      canReview: Boolean(actor && isHumanPostActor(actor) && (actor.isAdmin || actor.keys.has('posts.knowledge.review'))),
    });
  }
  return states;
}

export function getKnowledgeState(postId: number, actor?: PostActor): PostKnowledge | null {
  return getKnowledgeStates([postId], actor).get(postId) ?? null;
}

export function requireKnowledgeRow(actor: PostActor, postId: number, options: { allowDeleted?: boolean } = {}): KnowledgeRow & { post: PostRow } {
  requireKey(actor, 'posts.view');
  const row = findKnowledgeRow(postId);
  const post = db().prepare('SELECT * FROM posts WHERE id = ?').get(postId) as PostRow | undefined;
  if (!row || !post || !canSeePost(actor, post) || (row.deleted_at && (!options.allowDeleted || !canEditPost(actor, post)))) throw new PostError('지식 문서를 찾을 수 없어.', 404);
  return { ...row, post };
}

export function requireKnowledgeRevision(expected: unknown, revision: number) {
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1) throw new PostError('지식 문서 변경에는 expectedRevision이 필요해.', 400, 'EXPECTED_REVISION_REQUIRED');
  if (expected !== revision) throw new PostError(`다른 곳에서 먼저 고쳤어 (현재 판 ${revision}). 다시 불러와줘.`, 409, 'REVISION_CONFLICT');
}

export function knowledgeSources(postId: number): PostKnowledgeSource[] {
  return (db().prepare('SELECT source_json FROM post_knowledge_sources WHERE post_id = ? ORDER BY position').all(postId) as Array<{ source_json: string }>).map(row => JSON.parse(row.source_json));
}

function nullableId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new PostError('출처의 ID 또는 판이 잘못됐어.');
  return value;
}

/** Exact citations already validated by the server are durable proof, without inventing a missing historic body. */
function archivedKnowledgeSource(source: PostKnowledgeSource, hash: unknown = source.contentHash, publishedOnly = false): PostKnowledgeSource | null {
  if (typeof hash !== 'string' || !hash) return null;
  const found = db().prepare(`SELECT s.value AS source_json FROM post_knowledge_versions v,json_each(v.sources_json) s
    WHERE (?=0 OR v.post_status='published') AND json_extract(s.value,'$.kind')=?
      AND json_extract(s.value,'$.postId') IS ? AND json_extract(s.value,'$.commentId') IS ?
      AND json_extract(s.value,'$.contentVersion') IS ? AND json_extract(s.value,'$.revision') IS ?
      AND json_extract(s.value,'$.contentHash')=? AND json_extract(s.value,'$.quote')=?
      AND json_extract(s.value,'$.start') IS ? AND json_extract(s.value,'$.end') IS ? LIMIT 1`)
    .get(publishedOnly ? 1 : 0,source.kind,source.postId,source.commentId,source.contentVersion,source.revision,hash,source.quote,source.start,source.end) as { source_json: string } | undefined;
  return found ? { ...JSON.parse(found.source_json) as PostKnowledgeSource,observedAt: source.observedAt } : null;
}

/** Resolve and validate citations against server snapshots, rather than trusting client hashes or quotes. */
export function normalizeKnowledgeSources(actor: PostActor, value: unknown): PostKnowledgeSource[] {
  if (!Array.isArray(value) || value.length > 100) throw new PostError('출처는 최대 100개까지 배열로 전달해줘.');
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new PostError('잘못된 출처야.');
    const input = raw as Record<string, unknown>;
    if (!['post', 'comment', 'url'].includes(String(input.kind))) throw new PostError('출처 종류는 post, comment, url 중 하나야.');
    const kind = input.kind as PostKnowledgeSource['kind'];
    const quote = typeof input.quote === 'string' ? input.quote.normalize('NFC').replace(/\r\n?/g, '\n') : '';
    if (quote.length > 4000) throw new PostError('출처 인용은 4,000자까지야.');
    const source: PostKnowledgeSource = { kind, postId: nullableId(input.postId), commentId: nullableId(input.commentId), url: null,
      contentVersion: nullableId(input.contentVersion), contentHash: null, revision: nullableId(input.revision),
      start: input.start == null ? null : Number(input.start), end: input.end == null ? null : Number(input.end), quote,
      observedAt: typeof input.observedAt === 'string' && Number.isFinite(Date.parse(input.observedAt)) ? new Date(input.observedAt).toISOString() : null };
    let body = '';
    if (kind === 'url') {
      let url: URL;
      try { url = new URL(String(input.url)); } catch { throw new PostError('출처 URL이 잘못됐어.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2000) throw new PostError('출처 URL은 공개 http(s) 주소여야 해.');
      source.url = url.href;
      source.postId = source.commentId = source.contentVersion = source.revision = null;
      if (source.start !== null || source.end !== null) throw new PostError('외부 출처에 서버 본문 구간을 지정할 수 없어.');
      return source;
    }
    if (kind === 'comment') {
      if (!source.commentId) throw new PostError('댓글 출처에는 commentId가 필요해.');
      const comment = db().prepare('SELECT post_id,body,revision,status FROM post_comments WHERE id = ?').get(source.commentId) as { post_id: number; body: string; revision: number; status: string } | undefined;
      if (!comment || comment.status !== 'visible') throw new PostError('출처 댓글을 찾을 수 없어.', 404);
      if (source.postId !== null && source.postId !== comment.post_id) throw new PostError('출처 댓글과 문서가 맞지 않아.');
      source.postId = comment.post_id;
      PostStore.get(actor, comment.post_id);
      if (source.revision !== null && source.revision !== comment.revision) {
        const archived = archivedKnowledgeSource(source,input.contentHash);
        if (archived) return archived;
        throw new PostError('댓글의 요청한 이전 판은 더 이상 확인할 수 없어.',409);
      }
      source.revision = comment.revision; source.contentVersion = null; body = comment.body;
      source.contentHash = createHash('sha256').update(body).digest('hex');
    } else {
      if (!source.postId) throw new PostError('게시글 출처에는 postId가 필요해.');
      const post = PostStore.get(actor, source.postId);
      const knowledge = findKnowledgeRow(source.postId);
      if (source.contentVersion !== null) {
        const version = db().prepare('SELECT body,content_hash,post_revision,post_status FROM post_knowledge_versions WHERE post_id = ? AND content_version = ?').get(source.postId, source.contentVersion) as { body: string; content_hash: string; post_revision: number; post_status: string } | undefined;
        if (!version) throw new PostError('출처 내용 판을 찾을 수 없어.', 404);
        body = version.body; source.contentHash = version.content_hash; source.revision = version.post_revision;
        if (version.post_status !== 'published' && !(post.status === 'published' && version.content_hash === knowledge?.content_hash) && !archivedKnowledgeSource(source,source.contentHash,true) && !canEditPost(actor,db().prepare('SELECT * FROM posts WHERE id=?').get(source.postId) as PostRow)) throw new PostError('비공개였던 이전 내용 판에 접근할 수 없어.',403);
      } else if (source.revision !== null && source.revision !== post.revision) {
        const publicArchive = archivedKnowledgeSource(source,input.contentHash,true);
        if (publicArchive) return publicArchive;
        if (!canEditPost(actor,db().prepare('SELECT * FROM posts WHERE id=?').get(source.postId) as PostRow)) throw new PostError('출처 이전 판을 볼 권한이 없어.',403);
        const revision = db().prepare('SELECT body FROM post_revisions WHERE post_id = ? AND revision = ?').get(source.postId, source.revision) as { body: string } | undefined;
        if (!revision) {
          const archived = archivedKnowledgeSource(source,input.contentHash);
          if (archived) return archived;
          throw new PostError('출처 게시글의 이전 판을 찾을 수 없어.',404);
        }
        body = revision.body; source.contentHash = createHash('sha256').update(body).digest('hex');
      } else {
        body = post.body; source.revision = post.revision;
        source.contentVersion = knowledge?.content_version ?? null;
        source.contentHash = knowledge?.content_hash ?? createHash('sha256').update(body).digest('hex');
      }
      source.commentId = null;
    }
    if (input.contentHash != null && input.contentHash !== source.contentHash) throw new PostError('출처 내용 해시가 현재 확인한 판과 달라.', 409);
    if (source.start !== null || source.end !== null) {
      if (!Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end) || source.start! < 0 || source.end! <= source.start! || source.end! > body.length) throw new PostError('출처 구간이 본문 범위를 벗어났어.');
      if (quote && !body.slice(source.start!, source.end!).includes(quote)) throw new PostError('인용이 출처 구간에 존재하지 않아.');
    } else if (quote && !body.includes(quote)) throw new PostError('인용이 출처 본문에 존재하지 않아.');
    return source;
  });
}

export function assertKnowledgeSourceVisibility(actor: PostActor, status: string, sources: PostKnowledgeSource[]) {
  for (const source of sources) {
    if (!source.postId) continue;
    const post = db().prepare('SELECT * FROM posts WHERE id = ?').get(source.postId) as PostRow | undefined;
    const knowledge = findKnowledgeRow(source.postId);
    if (!post || !canSeePost(actor, post) || knowledge?.deleted_at) throw new PostError('출처 문서에 접근할 수 없어.', 403);
    if (status === 'published' && post.status !== 'published') throw new PostError('공개 문서에 비공개 게시글의 출처·인용을 넣을 수 없어.', 403);
    if (status === 'published' && source.kind === 'post' && source.contentVersion !== null) {
      const version = db().prepare('SELECT post_status,content_hash FROM post_knowledge_versions WHERE post_id=? AND content_version=?').get(source.postId,source.contentVersion) as { post_status: string; content_hash: string } | undefined;
      if (!version || (version.post_status !== 'published' && version.content_hash !== knowledge?.content_hash && !archivedKnowledgeSource(source,source.contentHash,true))) throw new PostError('비공개로 저장된 과거 내용 판을 공개 출처로 사용할 수 없어.',403);
    } else if (status === 'published' && source.kind === 'post' && source.revision !== null && source.revision !== post.revision && source.contentHash !== createHash('sha256').update(post.body).digest('hex') && !archivedKnowledgeSource(source,source.contentHash,true)) throw new PostError('공개 여부를 확인할 수 없는 이전 게시글 판은 공개 출처로 사용할 수 없어.',403);
    if (status === 'published' && source.kind === 'comment' && source.commentId) {
      const comment = db().prepare('SELECT body FROM post_comments WHERE id=?').get(source.commentId) as { body: string } | undefined;
      if (comment && source.contentHash !== createHash('sha256').update(comment.body).digest('hex') && !archivedKnowledgeSource(source,source.contentHash,true)) throw new PostError('비공개였던 과거 댓글 인용을 공개 출처로 사용할 수 없어.',403);
    }
    if (source.commentId && !db().prepare("SELECT 1 FROM post_comments WHERE id = ? AND post_id = ? AND status = 'visible'").get(source.commentId, source.postId)) throw new PostError('출처 댓글에 접근할 수 없어.', 403);
  }
}

export function saveKnowledgeSources(postId: number, sources: PostKnowledgeSource[]) {
  db().prepare('DELETE FROM post_knowledge_sources WHERE post_id = ?').run(postId);
  const insert = db().prepare('INSERT INTO post_knowledge_sources(post_id,position,source_json) VALUES(?,?,?)');
  sources.forEach((source, index) => insert.run(postId, index, JSON.stringify(source)));
}

function snapshotKnowledgeMediaRefs(postId: number,contentVersion: number) {
  db().prepare(`INSERT INTO post_knowledge_media_refs(post_id,content_version,kind,ref,position,file_owner_key)
    SELECT post_id,?,kind,ref,position,file_owner_key FROM post_media_refs WHERE post_id=? AND owner_type='post'`)
    .run(contentVersion,postId);
}

const sourceManifest = (sources: PostKnowledgeSource[]) => sources.map(s => ({ kind: s.kind, postId: s.postId, commentId: s.commentId, url: s.url,
  contentVersion: s.contentVersion, contentHash: s.contentHash, revision: s.revision, start: s.start, end: s.end, quote: s.quote }));
export function knowledgeContentHash(title: string, body: string, sources: PostKnowledgeSource[]) {
  return createHash('sha256').update(JSON.stringify({ title, body, sources: sourceManifest(sources) })).digest('hex');
}

function readableSource(actor: PostActor, source: PostKnowledgeSource) {
  if (source.postId === null) return true;
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(source.postId) as PostRow | undefined;
  return Boolean(row && canSeePost(actor, row) && !findKnowledgeRow(source.postId)?.deleted_at && (!source.commentId || db().prepare("SELECT 1 FROM post_comments WHERE id = ? AND status = 'visible'").get(source.commentId)));
}
export function visibleKnowledgeSources(actor: PostActor, postId: number) { return knowledgeSources(postId).filter(source => readableSource(actor, source)); }

function knowledgeLinkText(body:string) {
  let fence: { marker: string; length: number } | null = null;
  return body.split('\n').map(line => {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null;
      return '';
    }
    if (delimiter) { fence = { marker: delimiter[1][0],length: delimiter[1].length }; return ''; }
    if (/^(?: {4}|\t)/.test(line)) return '';
    return line;
  }).join('\n').replace(/(`+)[\s\S]*?\1/g, '');
}

/** Preserve stable IDs, and never interpret code samples as links. */
export function syncKnowledgeLinks(actor: PostActor, post: PostRow) {
  const text=knowledgeLinkText(post.body);
  const links: Array<{ target: number | null; comment: number | null; name: string; relation: string }> = [];
  for (const match of text.matchAll(/(?<!!)\[([^\]\n]+)\]\(post:(\d+)(?:#comment-(\d+))?\)/g)) {
    const target = Number(match[2]); const comment = match[3] ? Number(match[3]) : null;
    const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(target) as PostRow | undefined;
    if (!row || !canSeePost(actor, row) || findKnowledgeRow(target)?.deleted_at) throw new PostError('연결 문서에 접근할 수 없어.', 403);
    if (post.status === 'published' && row.status !== 'published') throw new PostError('공개 문서에 비공개 문서의 연결을 추가할 수 없어.', 403);
    if (comment && !db().prepare("SELECT 1 FROM post_comments WHERE id = ? AND post_id = ? AND status = 'visible'").get(comment, target)) throw new PostError('연결 댓글을 찾을 수 없어.', 404);
    links.push({ target, comment, name: match[1], relation: 'reference' });
  }
  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) links.push({ target: null, comment: null, name: match[1].slice(0, 200), relation: 'unresolved' });
  db().prepare('DELETE FROM post_links WHERE post_id = ?').run(post.id);
  const insert = db().prepare('INSERT INTO post_links(post_id,target_post_id,target_comment_id,display_name,relation) VALUES(?,?,?,?,?)');
  for (const link of links.slice(0, 1000)) insert.run(post.id, link.target, link.comment, link.name, link.relation);
}

export function appendKnowledgeReview(actor: PostActor, postId: number, contentVersion: number, action: string, reason = '', evidenceQuote = '', issueId: number | null = null) {
  const post = db().prepare('SELECT status FROM posts WHERE id=?').get(postId) as { status: string };
  return Number(db().prepare('INSERT INTO post_review_events(post_id,content_version,action,actor_key,reason,evidence_quote,related_issue_id,public_reason) VALUES(?,?,?,?,?,?,?,?)')
    .run(postId, contentVersion, action, postActorAccountKey(actor), reason.slice(0, 4000), evidenceQuote.slice(0, 4000), issueId,post.status === 'published' ? 1 : 0).lastInsertRowid);
}

/** Called inside every post save transaction. Only actual title/body/source changes create content versions. */
export function syncKnowledgeContent(actor: PostActor, postId: number, reason = 'content changed') {
  const knowledge = findKnowledgeRow(postId);
  if (!knowledge) return;
  const post = db().prepare('SELECT * FROM posts WHERE id = ?').get(postId) as PostRow;
  const sources = knowledgeSources(postId);
  assertKnowledgeSourceVisibility(actor, post.status, sources);
  const hash = knowledgeContentHash(post.title, post.body, sources);
  if (hash !== knowledge.content_hash) {
    const previous = db().prepare('SELECT title FROM post_knowledge_versions WHERE post_id = ? AND content_version = ?').get(postId, knowledge.content_version) as { title: string } | undefined;
    if (previous && previous.title !== post.title) db().prepare('INSERT OR IGNORE INTO post_aliases(post_id,name,name_key) VALUES(?,?,?)').run(postId, previous.title, previous.title.toLowerCase());
    const version = knowledge.content_version + 1;
    db().prepare('INSERT INTO post_knowledge_versions(post_id,content_version,content_hash,post_revision,title,body,sources_json,post_status,changed_by,change_reason) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(postId, version, hash, post.revision, post.title, post.body, JSON.stringify(sources), post.status, postActorAccountKey(actor), reason);
    snapshotKnowledgeMediaRefs(postId,version);
    const open = db().prepare("SELECT 1 FROM post_review_events e WHERE e.post_id = ? AND e.action IN ('report_error','request_review') AND NOT EXISTS(SELECT 1 FROM post_review_events r WHERE r.related_issue_id = e.id AND r.action = 'resolve_issue')").get(postId);
    db().prepare('UPDATE post_knowledge SET content_version = ?,content_hash = ?,review_status = ?,updated_at = CURRENT_TIMESTAMP WHERE post_id = ?')
      .run(version, hash, knowledge.review_status === 'verified' || open ? 'needs_review' : 'unreviewed', postId);
    appendKnowledgeReview(actor, postId, version, 'content_change', reason);
  }
  syncKnowledgeLinks(actor, post);
}

export function knowledgeIssues(postId: number, actor?: PostActor): PostReviewIssue[] {
  const post = actor ? db().prepare('SELECT * FROM posts WHERE id=?').get(postId) as PostRow : null;
  return (db().prepare(`SELECT e.*,r.created_at AS resolved_at,r.reason AS resolution FROM post_review_events e
    LEFT JOIN post_review_events r ON r.id=(SELECT MAX(id) FROM post_review_events WHERE related_issue_id=e.id AND action='resolve_issue')
    WHERE e.post_id=? AND e.action IN ('report_error','request_review') ORDER BY e.id DESC`).all(postId) as Array<{ id: number; content_version: number; actor_key: string; public_reason: number; reason: string; evidence_quote: string; created_at: string; resolved_at: string | null; resolution: string | null }>).map(row => {
      const visible = !actor || row.public_reason === 1 || row.actor_key === postActorAccountKey(actor) || Boolean(post && canEditPost(actor,post));
      return { id: row.id,contentVersion: row.content_version,reason: visible ? row.reason : '비공개 이전 판의 검토 사유',evidenceQuote: visible ? row.evidence_quote : '',
        createdAt: date(row.created_at)!,resolvedAt: date(row.resolved_at),resolution: visible ? row.resolution : (row.resolved_at ? '검토자가 문제를 해결했어.' : null),evidenceAvailable: visible };
    });
}

function requirePermanentDeleteAuthority(actor:PostActor,postId:number,expectedRevision:unknown) {
  requireHumanPostActor(actor);requireKey(actor,'posts.write');
  const knowledge=requireKnowledgeRow(actor,postId,{allowDeleted:true});
  if(!canEditPost(actor,knowledge.post)) throw new PostError('이 지식 문서를 영구 삭제할 권한이 없어.',403);
  if(!knowledge.deleted_at) throw new PostError('휴지통에 있는 지식 문서만 영구 삭제할 수 있어.',409);
  requireKnowledgeRevision(expectedRevision,knowledge.post.revision);
  return knowledge;
}

function permanentDeletionAnalysis(actor:PostActor,knowledge:KnowledgeRow&{post:PostRow}) {
  const postId=knowledge.post_id;
  const count=(table:string,clause='post_id=?')=>(db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${clause}`).get(postId) as {n:number}).n;
  const counts:PostKnowledgePermanentDeletePreview['counts']={comments:count('post_comments'),versions:count('post_knowledge_versions'),revisions:count('post_revisions'),assessmentEvents:count('post_assessment_events'),
    assessmentHeads:count('post_assessment_events','post_id=? AND id IN (SELECT event_id FROM post_assessment_heads)'),moderations:count('post_assessment_moderations'),reviewEvents:count('post_review_events'),sources:count('post_knowledge_sources'),
    links:count('post_links'),aliases:count('post_aliases'),proposals:(db().prepare('SELECT COUNT(*) AS n FROM post_knowledge_proposals WHERE post_id=? OR applied_post_id=?').get(postId,postId) as {n:number}).n,
    uses:count('post_knowledge_uses'),evaluationRequests:count('post_evaluation_requests'),botRuns:count('post_bot_runs'),attachmentRefs:count('post_media_refs')+count('post_knowledge_media_refs')};
  const dependencies:PostKnowledgePermanentDeleteDependency[]=[];
  const proof:unknown[]=[];
  const add=(kind:PostKnowledgePermanentDeleteDependency['kind'],scope:PostKnowledgePermanentDeleteDependency['scope'],ownerPostId:number|null,n:number,blocking=true,privateTitle:string|null=null)=>{
    const post=ownerPostId===null?null:db().prepare('SELECT * FROM posts WHERE id=?').get(ownerPostId) as PostRow|undefined;
    const visible=post?canSeePost(actor,post):false;
    dependencies.push({kind,scope,postId:visible?ownerPostId:null,title:visible?post!.title:privateTitle,count:n,blocking});
    proof.push([kind,scope,ownerPostId,n,blocking]);
  };
  for(const row of db().prepare("SELECT s.post_id,COUNT(*) AS n FROM post_knowledge_sources s WHERE s.post_id<>? AND json_extract(s.source_json,'$.postId')=? GROUP BY s.post_id").all(postId,postId) as Array<{post_id:number;n:number}>) add('source','current',row.post_id,row.n);
  for(const row of db().prepare("SELECT v.post_id,COUNT(*) AS n FROM post_knowledge_versions v,json_each(v.sources_json) s WHERE v.post_id<>? AND json_extract(s.value,'$.postId')=? GROUP BY v.post_id").all(postId,postId) as Array<{post_id:number;n:number}>) add('source','history',row.post_id,row.n);
  for(const row of db().prepare('SELECT post_id FROM post_knowledge WHERE replacement_post_id=? AND post_id<>?').all(postId,postId) as Array<{post_id:number}>) add('replacement','current',row.post_id,1);
  const linked=(body:string)=>[...knowledgeLinkText(body).matchAll(/(?<!!)\[[^\]\n]+\]\(post:(\d+)(?:#comment-\d+)?\)/g)].some(match=>Number(match[1])===postId);
  for(const row of db().prepare('SELECT id,body FROM posts WHERE id<>?').all(postId) as Array<{id:number;body:string}>) if(linked(row.body)) add('link','current',row.id,1);
  for(const row of db().prepare('SELECT post_id,body FROM post_comments WHERE post_id<>?').all(postId) as Array<{post_id:number;body:string}>) if(linked(row.body)) add('link','current',row.post_id,1);
  for(const row of db().prepare('SELECT post_id,body FROM post_knowledge_versions WHERE post_id<>?').all(postId) as Array<{post_id:number;body:string}>) if(linked(row.body)) add('link','history',row.post_id,1);
  for(const row of db().prepare('SELECT post_id,body FROM post_revisions WHERE post_id<>?').all(postId) as Array<{post_id:number;body:string}>) if(linked(row.body)) add('link','history',row.post_id,1);
  const proposals=db().prepare('SELECT id,post_id,applied_post_id,title,body,base_body,sources_json,base_sources_json,proposer_account_key,status FROM post_knowledge_proposals WHERE (post_id IS NULL OR post_id<>?) AND (applied_post_id IS NULL OR applied_post_id<>?)').all(postId,postId) as Array<{id:string;post_id:number|null;title:string;body:string;base_body:string|null;sources_json:string;base_sources_json:string;proposer_account_key:string;status:string}>;
  for(const row of proposals) {
    const cited=[...(JSON.parse(row.sources_json) as PostKnowledgeSource[]),...(JSON.parse(row.base_sources_json) as PostKnowledgeSource[])].some(source=>source.postId===postId);
    if(cited||linked(row.body)||linked(row.base_body??'')) {add('proposal','proposal',row.post_id,1,true,actor.isAdmin||row.proposer_account_key===postActorAccountKey(actor)?row.title:null);proof.push(['proposal',row.id,row.status]);}
  }
  const activeEvaluations=db().prepare("SELECT id,status FROM post_evaluation_requests WHERE post_id=? AND status IN ('queued','running')").all(postId) as Array<{id:string;status:string}>;
  if(activeEvaluations.length) {add('evaluation','runtime',null,activeEvaluations.length);proof.push(activeEvaluations);}
  const activeBots=db().prepare("SELECT id,status FROM post_bot_runs WHERE post_id=? AND status IN ('queued','running')").all(postId) as Array<{id:number;status:string}>;
  if(activeBots.length) {add('bot_run','runtime',null,activeBots.length);proof.push(activeBots);}
  for(const row of db().prepare(`SELECT r.post_id,COUNT(*) AS n FROM (SELECT post_id,kind,ref FROM post_media_refs UNION ALL SELECT post_id,kind,ref FROM post_knowledge_media_refs) r
    WHERE r.post_id<>? AND EXISTS(SELECT 1 FROM post_knowledge_media_refs own WHERE own.post_id=? AND own.kind=r.kind AND own.ref=r.ref) GROUP BY r.post_id`).all(postId,postId) as Array<{post_id:number;n:number}>) add('shared_attachment','history',row.post_id,row.n,false);
  const comments=db().prepare('SELECT id,revision,status FROM post_comments WHERE post_id=? ORDER BY id').all(postId);
  const ownProposals=db().prepare('SELECT id,status,input_hash FROM post_knowledge_proposals WHERE post_id=? OR applied_post_id=? ORDER BY id').all(postId,postId);
  const lastEvent=(db().prepare('SELECT MAX(id) AS id FROM post_assessment_events WHERE post_id=?').get(postId) as {id:number|null}).id;
  const fingerprint=createHash('sha256').update(JSON.stringify([knowledge.post.revision,knowledge.content_hash,counts,proof,comments,ownProposals,lastEvent])).digest('hex');
  return {counts,dependencies,blocked:dependencies.some(dependency=>dependency.blocking),fingerprint};
}

function changed(postId: number, content = false) {
  publishRuntimeEvent({ name: 'posts.changed', topic: 'posts', visibility: 'all', payload: { postId, kind: 'post' } });
  if (content) notifySemanticChange('post');
  kickPostTopicEvaluationQueue();
}

export const KnowledgeStore = {
  permanentDeletePreview(actor:PostActor,postId:number,input:{expectedRevision?:unknown}):PostKnowledgePermanentDeletePreview {
    return db().transaction(()=>{
      const knowledge=requirePermanentDeleteAuthority(actor,postId,input.expectedRevision);
      const analysis=permanentDeletionAnalysis(actor,knowledge),token=randomUUID(),expiresAt=new Date(Date.now()+120000).toISOString();
      db().prepare('DELETE FROM post_knowledge_purge_previews WHERE expires_at<=?').run(new Date().toISOString());
      db().prepare('INSERT INTO post_knowledge_purge_previews(token,post_id,account_key,expected_revision,fingerprint,expires_at) VALUES(?,?,?,?,?,?)')
        .run(token,postId,postActorAccountKey(actor),knowledge.post.revision,analysis.fingerprint,expiresAt);
      return {postId,title:knowledge.post.title,expectedRevision:knowledge.post.revision,contentVersion:knowledge.content_version,counts:analysis.counts,dependencies:analysis.dependencies,blocked:analysis.blocked,previewToken:token,expiresAt,filesRetained:true as const};
    }).immediate();
  },

  permanentDelete(actor:PostActor,postId:number,input:{expectedRevision?:unknown;previewToken?:unknown;confirm?:unknown}):PostKnowledgePermanentDeleteResult {
    requireHumanPostActor(actor);requireKey(actor,'posts.write');
    if(input.confirm!==true||typeof input.previewToken!=='string'||!input.previewToken) throw new PostError('삭제 영향 확인과 명시적 영구 삭제 확인이 필요해.');
    const result=db().transaction(()=>{
      const prior=db().prepare('SELECT * FROM post_knowledge_deletions WHERE preview_token=? AND post_id=? AND account_key=?')
        .get(input.previewToken,postId,postActorAccountKey(actor)) as {expected_revision:number;deleted_at:string}|undefined;
      if(prior) {
        requireKnowledgeRevision(input.expectedRevision,prior.expected_revision);
        return {postId,deletedAt:date(prior.deleted_at)!,filesRetained:true as const};
      }
      const knowledge=requirePermanentDeleteAuthority(actor,postId,input.expectedRevision);
      const preview=db().prepare('SELECT * FROM post_knowledge_purge_previews WHERE token=? AND post_id=? AND account_key=?')
        .get(input.previewToken,postId,postActorAccountKey(actor)) as {expected_revision:number;fingerprint:string;expires_at:string}|undefined;
      if(!preview||Date.parse(preview.expires_at)<=Date.now()) throw new PostError('영구 삭제 영향 확인이 만료됐어. 다시 확인해줘.',409);
      const analysis=permanentDeletionAnalysis(actor,knowledge);
      if(preview.expected_revision!==knowledge.post.revision||preview.fingerprint!==analysis.fingerprint) throw new PostError('삭제 대상이나 연결 자료가 변경됐어. 삭제 영향을 다시 확인해줘.',409);
      if(analysis.blocked) throw new PostError('다른 문서의 연결·출처 또는 진행 중인 작업을 먼저 확인하고 정리해줘.',409,'KNOWLEDGE_DELETE_DEPENDENCIES');
      removePostSearchDocument(postId);
      db().prepare('DELETE FROM post_assessment_heads WHERE event_id IN (SELECT id FROM post_assessment_events WHERE post_id=?)').run(postId);
      db().prepare('DELETE FROM post_assessment_moderations WHERE post_id=?').run(postId);
      db().prepare('DELETE FROM post_evaluation_request_commands WHERE post_id=?').run(postId);
      db().prepare('DELETE FROM post_knowledge_proposals WHERE post_id=? OR applied_post_id=?').run(postId,postId);
      db().prepare('DELETE FROM posts WHERE id=?').run(postId);
      db().prepare('INSERT INTO post_knowledge_deletions(preview_token,post_id,expected_revision,account_key) VALUES(?,?,?,?)').run(input.previewToken,postId,knowledge.post.revision,postActorAccountKey(actor));
      const deletion=db().prepare('SELECT deleted_at FROM post_knowledge_deletions WHERE preview_token=?').get(input.previewToken) as {deleted_at:string};
      return {postId,deletedAt:date(deletion.deleted_at)!,filesRetained:true as const};
    }).immediate();
    changed(postId,true);
    return result;
  },

  patch(actor: PostActor, postId: number, input: { expectedRevision?: unknown; enabled?: unknown; sources?: unknown; replacementPostId?: unknown }): PostDetail {
    requireHumanPostActor(actor); requireKey(actor, 'posts.write');
    if (!loadPostsSettings().knowledge.enabled) throw new PostError('지식 기능이 꺼져 있어.', 409);
    db().transaction(() => {
      PostStore.get(actor, postId);
      const row = db().prepare('SELECT * FROM posts WHERE id=?').get(postId) as PostRow;
      if (!canEditPost(actor, row)) throw new PostError('지식 문서를 고칠 권한이 없어.', 403);
      requireKnowledgeRevision(input.expectedRevision, row.revision);
      const existing = findKnowledgeRow(postId);
      const enabled = input.enabled === undefined ? existing?.enabled ?? 1 : input.enabled === true ? 1 : input.enabled === false ? 0 : -1;
      if (enabled < 0) throw new PostError('enabled는 참 또는 거짓이어야 해.');
      const sources = input.sources === undefined ? knowledgeSources(postId) : normalizeKnowledgeSources(actor, input.sources);
      assertKnowledgeSourceVisibility(actor, row.status, sources);
      const replacement = input.replacementPostId === undefined ? existing?.replacement_post_id ?? null : nullableId(input.replacementPostId);
      if (replacement === postId) throw new PostError('자기 자신을 대체 문서로 지정할 수 없어.');
      if (replacement) {
        const target = PostStore.get(actor, replacement);
        if (row.status === 'published' && target.status !== 'published') throw new PostError('공개 문서의 대체 문서는 공개되어야 해.', 403);
      }
      saveKnowledgeSources(postId, sources);
      db().prepare('UPDATE posts SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(postId);
      if (!existing) {
        const hash = knowledgeContentHash(row.title, row.body, sources);
        db().prepare('INSERT INTO post_knowledge(post_id,enabled,content_version,content_hash,replacement_post_id) VALUES(?,?,1,?,?)').run(postId, enabled, hash, replacement);
        db().prepare('INSERT INTO post_knowledge_versions(post_id,content_version,content_hash,post_revision,title,body,sources_json,post_status,changed_by,change_reason) VALUES(?,1,?,?,?,?,?,?,?,?)')
          .run(postId, hash, row.revision + 1, row.title, row.body, JSON.stringify(sources), row.status, postActorAccountKey(actor), 'knowledge designated');
        snapshotKnowledgeMediaRefs(postId,1);
        appendKnowledgeReview(actor, postId, 1, enabled ? 'designate' : 'undesignate');
        syncKnowledgeLinks(actor, { ...row, revision: row.revision + 1 });
      } else {
        db().prepare('UPDATE post_knowledge SET enabled=?,replacement_post_id=?,updated_at=CURRENT_TIMESTAMP WHERE post_id=?').run(enabled, replacement, postId);
        syncKnowledgeContent(actor, postId, 'knowledge sources changed');
        if (enabled !== existing.enabled) appendKnowledgeReview(actor, postId, findKnowledgeRow(postId)!.content_version, enabled ? 'designate' : 'undesignate');
      }
      writePostSearchDocument(postId);
    }).immediate();
    changed(postId,true);
    return PostStore.get(actor, postId);
  },

  links(actor: PostActor, postId: number): PostKnowledgeLinks {
    requireKnowledgeRow(actor, postId);
    const links = (db().prepare('SELECT * FROM post_links WHERE post_id=? ORDER BY id').all(postId) as Array<{ target_post_id: number | null; target_comment_id: number | null; display_name: string; relation: 'reference' | 'unresolved' }>)
      .filter(link => link.target_post_id === null || readableSource(actor, { postId: link.target_post_id, commentId: link.target_comment_id } as PostKnowledgeSource))
      .map(link => ({ postId: link.target_post_id, commentId: link.target_comment_id, title: link.display_name, relation: link.relation }));
    const backlinks = (db().prepare('SELECT DISTINCT p.id,p.title,p.status,p.owner_account_id FROM post_links l JOIN posts p ON p.id=l.post_id WHERE l.target_post_id=? ORDER BY p.id').all(postId) as PostRow[])
      .filter(row => canSeePost(actor, row) && !findKnowledgeRow(row.id)?.deleted_at).map(row => ({ postId: row.id, title: row.title }));
    const aliases = (db().prepare('SELECT name FROM post_aliases WHERE post_id=? ORDER BY name_key').all(postId) as Array<{ name: string }>).map(row => row.name);
    return { sources: visibleKnowledgeSources(actor, postId), links, backlinks, aliases };
  },

  versions(actor: PostActor, postId: number): PostKnowledgeVersion[] {
    const knowledge = requireKnowledgeRow(actor, postId, { allowDeleted: true });
    if (!canEditPost(actor, knowledge.post)) throw new PostError('이전 내용을 볼 권한이 없어.', 403);
    return (db().prepare('SELECT * FROM post_knowledge_versions WHERE post_id=? ORDER BY content_version DESC').all(postId) as Array<{ content_version: number; content_hash: string; post_revision: number; title: string; body: string; sources_json: string; changed_by: string; change_reason: string; created_at: string }>).map(row => ({ contentVersion: row.content_version, contentHash: row.content_hash, postRevision: row.post_revision, title: row.title, body: row.body,
      sources: (JSON.parse(row.sources_json) as PostKnowledgeSource[]).filter(source => readableSource(actor, source)),
      attachments: db().prepare('SELECT kind,ref FROM post_knowledge_media_refs WHERE post_id=? AND content_version=? ORDER BY position').all(postId,row.content_version) as PostKnowledgeVersion['attachments'],
      changedBy: row.changed_by, changeReason: row.change_reason, createdAt: date(row.created_at)! }));
  },

  restoreVersion(actor: PostActor, postId: number, contentVersion: number, input: { expectedRevision?: unknown }): PostDetail {
    requireHumanPostActor(actor);
    db().transaction(() => {
      const knowledge = requireKnowledgeRow(actor, postId);
      requireKnowledgeRevision(input.expectedRevision, knowledge.post.revision);
      const row = db().prepare('SELECT title,body,sources_json FROM post_knowledge_versions WHERE post_id=? AND content_version=?').get(postId, contentVersion) as { title: string; body: string; sources_json: string } | undefined;
      if (!row) throw new PostError('복원할 내용 판을 찾을 수 없어.', 404);
      if (!canEditPost(actor, knowledge.post)) throw new PostError('복원할 권한이 없어.', 403);
      const sources = normalizeKnowledgeSources(actor, JSON.parse(row.sources_json));
      assertKnowledgeSourceVisibility(actor, knowledge.post.status, sources);
      saveKnowledgeSources(postId, sources);
      PostStore.update(actor, postId, { title: row.title, body: row.body, expectedRevision: knowledge.post.revision });
    }).immediate();
    return PostStore.get(actor, postId);
  },

  trash(actor: PostActor, postId: number, input: { expectedRevision?: unknown }) {
    requireHumanPostActor(actor); requireKey(actor, 'posts.write');
    db().transaction(() => {
      const knowledge = requireKnowledgeRow(actor, postId, { allowDeleted: true });
      if (!canEditPost(actor, knowledge.post)) throw new PostError('지울 권한이 없어.', 403);
      requireKnowledgeRevision(input.expectedRevision, knowledge.post.revision);
      if (knowledge.deleted_at) return;
      removePostSearchDocument(postId);
      db().prepare('UPDATE post_knowledge SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE post_id=?').run(postId);
      db().prepare('UPDATE posts SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(postId);
      appendKnowledgeReview(actor, postId, knowledge.content_version, 'trash');
      invalidatePostTopicRequests(postId,'not_published');
    }).immediate();
    changed(postId,true);
  },

  restore(actor: PostActor, postId: number, input: { expectedRevision?: unknown }): PostDetail {
    requireHumanPostActor(actor); requireKey(actor, 'posts.write');
    db().transaction(() => {
      const knowledge = requireKnowledgeRow(actor, postId, { allowDeleted: true });
      if (!canEditPost(actor, knowledge.post)) throw new PostError('복원할 권한이 없어.', 403);
      requireKnowledgeRevision(input.expectedRevision, knowledge.post.revision);
      if (!knowledge.deleted_at) return;
      db().prepare('UPDATE post_knowledge SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE post_id=?').run(postId);
      db().prepare('UPDATE posts SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(postId);
      writePostSearchDocument(postId);
      appendKnowledgeReview(actor, postId, knowledge.content_version, 'restore');
      onPostTopicWrite(actor,knowledge.post);
    }).immediate();
    changed(postId,true);
    return PostStore.get(actor, postId);
  },

  review(actor: PostActor, postId: number, input: { contentVersion?: unknown; action?: unknown; reason?: unknown; evidenceQuote?: unknown; issueId?: unknown }) {
    requireHumanPostActor(actor);
    const action = String(input.action);
    if (!['verify','request_review','report_error','resolve_issue'].includes(action)) throw new PostError('검토 동작이 잘못됐어.');
    requireKey(actor, action === 'report_error' ? 'posts.evaluate' : 'posts.knowledge.review');
    db().transaction(() => {
      const knowledge = requireKnowledgeRow(actor, postId);
      if (input.contentVersion !== knowledge.content_version) throw new PostError('검토 대상 내용이 변경됐어.', 409);
      const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 4000) : '';
      const evidence = typeof input.evidenceQuote === 'string' ? input.evidenceQuote.slice(0, 4000) : '';
      if (action !== 'verify' && !reason) throw new PostError('검토 사유 또는 해결 근거를 입력해줘.');
      if (evidence && !knowledge.post.body.includes(evidence)) throw new PostError('근거 위치가 문서 본문에 존재하지 않아.');
      const issueId = action === 'resolve_issue' ? nullableId(input.issueId) : null;
      if (action === 'resolve_issue' && (!issueId || !db().prepare("SELECT 1 FROM post_review_events WHERE id=? AND post_id=? AND action IN ('report_error','request_review')").get(issueId, postId))) throw new PostError('해결할 오류 제보를 찾을 수 없어.', 404);
      if (action === 'verify' && knowledgeIssues(postId).some(issue => !issue.resolvedAt)) throw new PostError('열린 오류와 재검토 사유를 해결한 뒤 검증해줘.', 409);
      appendKnowledgeReview(actor, postId, knowledge.content_version, action, reason, evidence, issueId);
      if (action === 'verify') db().prepare("UPDATE post_knowledge SET review_status='verified',verified_content_version=?,updated_at=CURRENT_TIMESTAMP WHERE post_id=?").run(knowledge.content_version, postId);
      else if (action !== 'resolve_issue') db().prepare("UPDATE post_knowledge SET review_status='needs_review',updated_at=CURRENT_TIMESTAMP WHERE post_id=?").run(postId);
    }).immediate();
    changed(postId);
    return { knowledge: getKnowledgeState(postId, actor)!, issues: knowledgeIssues(postId,actor) };
  },

  async reviewQueue(actor: PostActor, query: { offset?: unknown; limit?: unknown } = {}, options?: { signal?: AbortSignal }): Promise<PostKnowledgeReviewQueue> {
    requireKey(actor, 'posts.knowledge.review');
    const list = await PostStore.list(actor, { kind: 'knowledge', reviewStatus: 'needs_review', status: 'all', ...query }, options);
    return { items: list.items.map(post => ({ post, issues: knowledgeIssues(post.id,actor) })), total: list.total };
  },

  export(actor: PostActor, postId: number): PostKnowledgeExport {
    const knowledge = requireKnowledgeRow(actor, postId);
    const detail = PostStore.get(actor, postId);
    const links = KnowledgeStore.links(actor, postId);
    const attachments = (db().prepare("SELECT kind,ref FROM post_media_refs WHERE post_id=? AND owner_type='post' ORDER BY position").all(postId)) as PostKnowledgeExport['attachments'];
    return { postId, title: detail.title, markdown: detail.body, contentVersion: knowledge.content_version, contentHash: knowledge.content_hash, sources: links.sources, links: links.links, attachments };
  },
};
