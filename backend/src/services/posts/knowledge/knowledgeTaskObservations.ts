import type { ChatExecutionContext, PostKnowledgeTaskContext, PostKnowledgeTaskPurpose } from '@conai/shared';
import { getUserSettingsDb } from '../../../database/userSettingsDb';
import type { McpRequester } from '../../../mcp/context';
import { audioCandidatesByQueueJob, audioOrderGroupsByQueueJob } from '../../audio/audioJobCandidates';
import { loadPostsSettings } from '../postsSettings';
import { requireKey, type PostActor } from '../postActor';
import { currentKnowledgeActor, ensureKnowledgeExecution, knowledgeExecutionFromChat, knowledgeHash, requireKnowledgeExecution,
  type KnowledgeExecutionContext, type KnowledgeExecutionRow } from './knowledgeRuntime';

const db=()=>getUserSettingsDb();
const purposes:Record<string,PostKnowledgeTaskPurpose['kind']>={image:'image_generation',redraw:'image_redraw',audio:'audio_generation',lore:'lore_save',choices:'choices'};

/** The caller has already authorized and validated runChatOrder's human-selected kind. No model tool invokes this. */
export function beginKnowledgeOrderTask(requester:McpRequester,context:ChatExecutionContext,kind:string):void {
  if(!loadPostsSettings().knowledge.enabled||!purposes[kind]) return;
  const actor=currentKnowledgeActor(requester.accountId,context.profileId,'chat');
  if(!actor.isAdmin&&!actor.keys.has('posts.view')) return;
  const purpose=purposes[kind];
  // Resolve the real provider/model later, immediately before the first tool call. A CLI default is not a model identity.
  context.knowledgeTaskPurpose={kind:purpose,source:'human_order',conditionKey:`order:${knowledgeHash(purpose)}`};
}

/** Bind only the queue job the server actually linked to this exact active execution and owning account. */
export function bindKnowledgeGenerationOperation(context:ChatExecutionContext,jobId:number):void {
  if(!loadPostsSettings().knowledge.enabled||!context.replyId) return;
  const executionId=context.knowledgeExecutionId??`chat:${context.threadId}:reply:${context.replyId}`;
  let execution=db().prepare('SELECT * FROM post_knowledge_executions WHERE execution_id=?').get(executionId) as KnowledgeExecutionRow|undefined;
  if(!execution&&context.knowledgeTaskPurpose) {
    const thread=db().prepare('SELECT account_id FROM codex_chat_threads WHERE id=?').get(context.threadId) as {account_id:number|null}|undefined;
    if(thread) execution=ensureKnowledgeExecution(knowledgeExecutionFromChat({accountId:thread.account_id,accountType:null},context));
  }
  if(!execution||execution.status!=='running'||execution.profile_id!==context.profileId||execution.trust!=='observed_execution') return;
  if(!db().prepare('SELECT 1 FROM post_knowledge_tasks WHERE execution_id=?').get(executionId)) return;
  const job=db().prepare(`SELECT j.requested_by_account_id FROM generation_queue_jobs j JOIN chat_generation_links l ON l.job_id=j.id
    JOIN codex_chat_threads t ON t.id=l.thread_id WHERE j.id=? AND l.thread_id=? AND l.reply_id=? AND t.account_id IS j.requested_by_account_id`)
    .get(jobId,context.threadId,context.replyId) as {requested_by_account_id:number|null}|undefined;
  if(!job||job.requested_by_account_id!==execution.account_id) return;
  db().prepare('INSERT OR IGNORE INTO post_knowledge_task_jobs(execution_id,job_id,thread_id,reply_id) VALUES(?,?,?,?)')
    .run(executionId,jobId,context.threadId,context.replyId);
}

export function knowledgeTaskContext(context:KnowledgeExecutionContext,actor:PostActor):PostKnowledgeTaskContext {
  const execution=requireKnowledgeExecution(context);
  const empty:PostKnowledgeTaskContext={purpose:null,observations:[],goalOutcome:'unknown',evidenceAvailable:false};
  if(execution.trust!=='observed_execution'||actor.accountId!==execution.account_id) return empty;
  requireKey(actor,'posts.view');requireKey(actor,'posts.evaluate');
  const task=db().prepare('SELECT purpose_kind,condition_key,expires_at FROM post_knowledge_tasks WHERE execution_id=?').get(context.executionId) as {purpose_kind:PostKnowledgeTaskPurpose['kind'];condition_key:string;expires_at:string}|undefined;
  if(!task||Date.parse(task.expires_at)<=Date.now()) return empty;
  const purpose:PostKnowledgeTaskPurpose={kind:task.purpose_kind,source:'human_order',conditionKey:task.condition_key};
  const jobs=db().prepare(`SELECT j.id,j.status,j.completed_at,j.service_type,b.created_at AS bound_at FROM post_knowledge_task_jobs b JOIN generation_queue_jobs j ON j.id=b.job_id
    JOIN chat_generation_links l ON l.job_id=j.id AND l.thread_id=b.thread_id AND l.reply_id=b.reply_id
    JOIN codex_chat_threads t ON t.id=b.thread_id WHERE b.execution_id=? AND t.account_id IS ? AND j.requested_by_account_id IS ? ORDER BY j.id LIMIT 5`)
    .all(context.executionId,execution.account_id,execution.account_id) as Array<{id:number;status:string;completed_at:string|null;service_type:string;bound_at:string}>;
  if(!actor.isAdmin&&!actor.keys.has('images.view')&&!actor.keys.has('audio.view')) return {...empty,purpose};
  const audioJobs=audioOrderGroupsByQueueJob(jobs.map(job=>job.id));
  const audio=audioCandidatesByQueueJob(jobs.map(job=>job.id));
  const observations:PostKnowledgeTaskContext['observations']=[];
  for(const job of jobs) {
    const operation=audioJobs.has(job.id)?'audio_generation':'image_generation';
    if(!actor.isAdmin&&!actor.keys.has(operation==='audio_generation'?'audio.view':'images.view')) continue;
    const imageCount=operation==='image_generation'?(db().prepare(`SELECT COUNT(*) AS count FROM api_generation_history
      WHERE queue_job_id=? AND requested_by_account_id IS ? AND generation_status='completed' AND composite_hash IS NOT NULL`).get(job.id,execution.account_id) as {count:number}).count:0;
    const artifactCount=operation==='audio_generation'?audio.get(job.id)?.length??0:imageCount;
    const status=job.status==='completed'?(artifactCount>0?'succeeded':'unknown'):job.status==='failed'?'failed':job.status==='cancelled'?'cancelled':'pending';
    observations.push({source:'generation_queue',scope:'operation',operation,operationKey:knowledgeHash(`queue:${job.id}`),status,artifactCount,
      observedAt:(job.completed_at??job.bound_at).includes('T')?(job.completed_at??job.bound_at):`${(job.completed_at??job.bound_at).replace(' ','T')}Z`});
  }
  return {purpose,observations,goalOutcome:'unknown',evidenceAvailable:observations.some(observation=>observation.status==='succeeded'||observation.status==='failed')};
}
