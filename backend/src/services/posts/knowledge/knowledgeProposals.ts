import { randomUUID } from 'node:crypto';
import { POST_LIMITS, type PostKnowledgeProposal, type PostKnowledgeProposalInput, type PostKnowledgeProposalList, type PostKnowledgeSource } from '@conai/shared';
import { getUserSettingsDb } from '../../../database/userSettingsDb';
import { ChatProfileStore } from '../../codex-chat/chatProfiles';
import { fileOwnerKey } from '../../fileStoreService';
import { assertKnowledgeSourceVisibility, getKnowledgeState, knowledgeSources, KnowledgeStore, normalizeKnowledgeSources, requireKnowledgeRow } from '../knowledgeStore';
import { PostError, requireKey, type PostActor } from '../postActor';
import { extractMediaRefs } from '../postMedia';
import { canEditPost, iso, PostStore, requirePostRow } from '../postStore';
import { loadPostsSettings } from '../postsSettings';
import { knowledgeAccountKey, knowledgeHash } from './knowledgeRuntime';

const db = () => getUserSettingsDb();
type ProposalRow = {
  id:string; kind:'create'|'update'; post_id:number|null; base_revision:number|null; base_content_version:number|null;
  base_title:string|null; base_body:string|null;base_sources_json:string; title:string; body:string; sources_json:string; input_json:string;input_hash:string;idempotency_key:string;
  proposer_account_key:string;proposer_account_id:number|null;proposer_profile_id:number|null;proposer_name:string;proposer_origin:string;reason:string;
  status:'pending'|'applied'|'rejected';review_reason:string|null;reviewed_at:string|null;applied_post_id:number|null;applied_revision:number|null;applied_content_version:number|null;created_at:string;
};

function human(actor: PostActor): boolean { return actor.profileId === null && (actor.origin ?? 'human') === 'human'; }
function authority(actor:PostActor,row:ProposalRow):boolean {
  if (!human(actor) || (!actor.isAdmin && !actor.keys.has('posts.write'))) return false;
  if (row.post_id === null) return actor.isAdmin || row.proposer_account_key === knowledgeAccountKey(actor.accountId);
  try { return canEditPost(actor,requirePostRow(actor,row.post_id)); } catch { return false; }
}

/** Draft content is only disclosed to the proposer and human reviewers able to apply it. */
function requireProposal(actor:PostActor,id:string):ProposalRow {
  const row=db().prepare('SELECT * FROM post_knowledge_proposals WHERE id = ?').get(id) as ProposalRow|undefined;
  if (!row) throw new PostError('지식 변경 제안을 찾을 수 없어.',404);
  if (row.proposer_account_key !== knowledgeAccountKey(actor.accountId) && !authority(actor,row)) throw new PostError('지식 변경 제안을 찾을 수 없어.',404);
  if (row.post_id !== null) requirePostRow(actor,row.post_id);
  // A source may have been hidden or removed since proposal submission. Never expose its saved quote through the proposal.
  normalizeKnowledgeSources(actor,JSON.parse(row.sources_json));
  normalizeKnowledgeSources(actor,JSON.parse(row.base_sources_json));
  return row;
}
function toProposal(actor:PostActor,row:ProposalRow):PostKnowledgeProposal {
  const allowed=row.status === 'pending' && authority(actor,row);
  const input=JSON.parse(row.input_json) as PostKnowledgeProposalInput;
  const target=row.post_id===null?null:requirePostRow(actor,row.post_id);
  return { id:row.id,kind:row.kind,postId:row.post_id,baseRevision:row.base_revision,baseContentVersion:row.base_content_version,
    title:row.title,body:row.body,baseTitle:row.base_title,baseBody:row.base_body,baseSources:JSON.parse(row.base_sources_json),sources:JSON.parse(row.sources_json),status:row.status,reason:row.reason,
    proposedPostStatus:target?.status??(input.status==='published'?'published':'draft'),categoryId:target?.category_id??input.categoryId??null,
    tags:target?PostStore.get(actor,target.id).tags:Array.isArray(input.tags)?input.tags:[],attachments:extractMediaRefs(row.body),
    proposedByName:row.proposer_name,createdAt:iso(row.created_at) as string,reviewedAt:iso(row.reviewed_at),reviewReason:row.review_reason,
    appliedPostId:row.applied_post_id,appliedRevision:row.applied_revision,appliedContentVersion:row.applied_content_version,canApply:allowed,canReject:allowed };
}

/** Every file must retain the existing post's provenance or belong to the writer's actual store. */
function validateFiles(actor:PostActor,body:string,targetPostId:number|null,sources:PostKnowledgeSource[]) {
  const refs=extractMediaRefs(body);
  for (const ref of refs) {
    if (ref.kind !== 'file') continue;
    const own = db().prepare("SELECT 1 FROM stored_file_entries WHERE id = ? AND owner_key = ? AND kind = 'file' AND deleted_at IS NULL").get(ref.ref,fileOwnerKey(actor.accountId));
    const previous = targetPostId ? db().prepare("SELECT 1 FROM post_media_refs WHERE post_id = ? AND owner_type = 'post' AND owner_id = ? AND kind = 'file' AND ref = ?").get(targetPostId,targetPostId,ref.ref) : null;
    if (own || previous) continue;
    // A source proves where it came from but does not grant a cross-account copy of a private file.
    const source = sources.find((item) => item.postId && db().prepare("SELECT 1 FROM post_media_refs WHERE post_id = ? AND owner_type = ? AND owner_id = ? AND kind = 'file' AND ref = ?")
      .get(item.postId,item.kind === 'comment' ? 'comment' : 'post',item.commentId ?? item.postId,ref.ref));
    if (source) throw new PostError('출처의 첨부파일을 먼저 승인 계정 보관함에 복사한 뒤 제안해줘.',403);
    throw new PostError('본문 첨부파일의 출처나 보관함 권한을 확인할 수 없어.',403);
  }
}

export const KnowledgeProposalStore = {
  create(actor:PostActor,input:PostKnowledgeProposalInput):PostKnowledgeProposal {
    requireKey(actor,'posts.write'); requireKey(actor,'posts.view');
    if (!loadPostsSettings().knowledge.enabled) throw new PostError('지식 기능이 꺼져 있어.',409);
    if (!input || !['create','update'].includes(input.kind) || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > POST_LIMITS.title
      || typeof input.body !== 'string' || input.body.length > POST_LIMITS.body || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 160) throw new PostError('지식 변경 제안 입력이 잘못됐어.');
    if(input.status!==undefined&&input.status!=='draft'&&input.status!=='published') throw new PostError('신규 제안의 발행 상태는 draft 또는 published야.');
    const inputJson=JSON.stringify(input);
    const inputHash=knowledgeHash(inputJson);
    const key=knowledgeAccountKey(actor.accountId);
    return db().transaction(() => {
      const duplicate=db().prepare('SELECT * FROM post_knowledge_proposals WHERE proposer_account_key = ? AND COALESCE(proposer_profile_id,0) = ? AND idempotency_key = ?')
        .get(key,actor.profileId ?? 0,input.idempotencyKey.trim()) as ProposalRow|undefined;
      if (duplicate) {
        if (duplicate.input_hash !== inputHash) throw new PostError('같은 멱등 키로 다른 제안을 제출했어.',409);
        return toProposal(actor,requireProposal(actor,duplicate.id));
      }
      const post=input.kind === 'update' ? requirePostRow(actor,Number(input.postId)) : null;
      const knowledge=post ? requireKnowledgeRow(actor,post.id) : null;
      if (post && (!Number.isSafeInteger(input.baseRevision) || input.baseRevision !== post.revision
        || !Number.isSafeInteger(input.baseContentVersion) || input.baseContentVersion !== knowledge?.content_version)) throw new PostError('제안의 기준 판이 현재 문서와 달라. 새로 불러와줘.',409);
      if (input.kind === 'create' && input.postId !== undefined) throw new PostError('신규 제안에는 기존 문서 ID를 지정할 수 없어.');
      const sources=normalizeKnowledgeSources(actor,input.sources);
      const status=post?.status ?? (input.status === 'published' ? 'published' : 'draft');
      assertKnowledgeSourceVisibility(actor,status,sources);
      validateFiles(actor,input.body,post?.id ?? null,sources);
      const id=randomUUID();
      const profile=actor.profileId !== null ? ChatProfileStore.find(actor.profileId) : null;
      if (actor.profileId !== null && !profile) throw new PostError('제안 프로필을 찾을 수 없어.',404);
      db().prepare(`INSERT INTO post_knowledge_proposals (id,kind,post_id,base_revision,base_content_version,base_title,base_body,base_sources_json,title,body,sources_json,input_json,input_hash,idempotency_key,
        proposer_account_key,proposer_account_id,proposer_profile_id,proposer_name,proposer_origin,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,input.kind,post?.id ?? null,post?.revision ?? null,knowledge?.content_version ?? null,post?.title ?? null,post?.body ?? null,JSON.stringify(post ? knowledgeSources(post.id) : []),input.title.trim(),input.body,
          JSON.stringify(sources),inputJson,inputHash,input.idempotencyKey.trim(),key,actor.accountId,actor.profileId,profile?.name ?? (actor.accountId === null ? 'owner' : `#${actor.accountId}`),
          actor.origin ?? (actor.profileId === null ? 'human' : 'chat'),typeof input.reason === 'string' ? input.reason.trim().slice(0,1000) : '');
      return toProposal(actor,requireProposal(actor,id));
    }).immediate();
  },

  get(actor:PostActor,id:string):PostKnowledgeProposal { requireKey(actor,'posts.view');return toProposal(actor,requireProposal(actor,id)); },

  list(actor:PostActor,query:{postId?:unknown;status?:unknown;offset?:unknown;limit?:unknown}={}):PostKnowledgeProposalList {
    requireKey(actor,'posts.view');
    const offset=query.offset === undefined ? 0 : Number(query.offset),limit=query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50) throw new PostError('잘못된 제안 목록 범위야.');
    const where:string[]=[],params:unknown[]=[];
    if (query.postId !== undefined) { requirePostRow(actor,Number(query.postId));where.push('post_id = ?');params.push(Number(query.postId)); }
    if (query.status !== undefined) { if (!['pending','applied','rejected','all'].includes(String(query.status))) throw new PostError('잘못된 제안 상태야.');if (query.status !== 'all') {where.push('status = ?');params.push(query.status);} }
    const rows=db().prepare(`SELECT * FROM post_knowledge_proposals ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC`).all(...params) as ProposalRow[];
    const visible:ProposalRow[]=[];
    for(const row of rows) { try {visible.push(requireProposal(actor,row.id));} catch(error) {if(!(error instanceof PostError)||![403,404,410].includes(error.status)) throw error;} }
    return {items:visible.slice(offset,offset+limit).map((row)=>toProposal(actor,row)),total:visible.length,offset,limit};
  },

  apply(actor:PostActor,id:string,input:{expectedRevision?:unknown;contentVersion?:unknown}={}):PostKnowledgeProposal {
    if (!human(actor)) throw new PostError('사람 세션에서만 지식 변경을 승인할 수 있어.',403);
    requireKey(actor,'posts.write');
    if(!loadPostsSettings().knowledge.enabled) throw new PostError('지식 기능이 꺼져 있어.',409);
    return db().transaction(() => {
      const row=requireProposal(actor,id);
      if (!authority(actor,row)) throw new PostError('이 제안을 승인할 편집 권한이 없어.',403);
      if (row.status === 'applied') return toProposal(actor,row);
      if (row.status !== 'pending') throw new PostError('이미 거절된 제안이야.',409);
      const proposed=JSON.parse(row.input_json) as PostKnowledgeProposalInput;
      const sources=normalizeKnowledgeSources(actor,JSON.parse(row.sources_json));
      let post;
      if(row.kind === 'update') {
        const current=requirePostRow(actor,row.post_id as number),knowledge=requireKnowledgeRow(actor,current.id);
        if (!Number.isSafeInteger(Number(input.expectedRevision)) || Number(input.expectedRevision) !== row.base_revision || current.revision !== row.base_revision
          || !Number.isSafeInteger(Number(input.contentVersion)) || Number(input.contentVersion) !== row.base_content_version || knowledge.content_version !== row.base_content_version) throw new PostError('승인 전에 문서가 변경됐어. 기준 판을 다시 검토해줘.',409);
        assertKnowledgeSourceVisibility(actor,current.status,sources);
        validateFiles(actor,row.body,current.id,sources);
        post=PostStore.update(actor,current.id,{title:row.title,body:row.body,knowledgeSources:sources,expectedRevision:row.base_revision});
        post=PostStore.get(actor,post.id);
      } else {
        const status=proposed.status === 'published' ? 'published' : 'draft';
        assertKnowledgeSourceVisibility(actor,status,sources);
        validateFiles(actor,row.body,null,sources);
        post=PostStore.create(actor,{title:row.title,body:row.body,categoryId:proposed.categoryId,tags:proposed.tags,status},'knowledge-proposal');
        KnowledgeStore.patch(actor,post.id,{enabled:true,sources,expectedRevision:post.revision});
        post=PostStore.get(actor,post.id);
      }
      const knowledge=getKnowledgeState(post.id);
      const changed=db().prepare(`UPDATE post_knowledge_proposals SET status = 'applied',reviewer_account_key = ?,reviewed_at = CURRENT_TIMESTAMP,applied_post_id = ?,applied_revision = ?,applied_content_version = ? WHERE id = ? AND status = 'pending'`)
        .run(knowledgeAccountKey(actor.accountId),post.id,post.revision,knowledge?.contentVersion ?? null,id);
      if(changed.changes !== 1) throw new PostError('다른 승인자가 먼저 처리했어.',409);
      return toProposal(actor,requireProposal(actor,id));
    }).immediate();
  },

  reject(actor:PostActor,id:string,input:{reason?:unknown}={}):PostKnowledgeProposal {
    if(!human(actor)) throw new PostError('사람 세션에서만 제안을 거절할 수 있어.',403);
    return db().transaction(()=>{
      const row=requireProposal(actor,id);
      if(!authority(actor,row)) throw new PostError('이 제안을 검토할 편집 권한이 없어.',403);
      if(row.status === 'rejected') return toProposal(actor,row);
      if(row.status !== 'pending') throw new PostError('이미 적용된 제안이야.',409);
      db().prepare(`UPDATE post_knowledge_proposals SET status = 'rejected',reviewer_account_key = ?,review_reason = ?,reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`)
        .run(knowledgeAccountKey(actor.accountId),typeof input.reason === 'string' ? input.reason.trim().slice(0,1000) : '',id);
      return toProposal(actor,requireProposal(actor,id));
    }).immediate();
  },
};
