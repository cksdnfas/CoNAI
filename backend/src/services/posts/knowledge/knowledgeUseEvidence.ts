import { getUserSettingsDb } from '../../../database/userSettingsDb';
import { PostError, type PostActor } from '../postActor';
import { requireKnowledgeRow } from '../knowledgeStore';
import { loadPostsSettings } from '../postsSettings';
import { knowledgeHash, type KnowledgeExecutionRow, type KnowledgeUseRow } from './knowledgeRuntime';

export type KnowledgeEvidenceRequest = {id:string;post_id:number;content_version:number;content_hash:string;requester_account_key:string;root_execution_id:string;execution_id:string|null;use_id:string|null;task_key:string|null};
export type KnowledgeBodySegment={scope:'body';start:number;end:number;text:string};
export function mergeKnowledgeIntervals(intervals:Array<{start:number;end:number}>):Array<{start:number;end:number}> {
  const result:Array<{start:number;end:number}>=[];
  for(const interval of [...intervals].sort((a,b)=>a.start-b.start||a.end-b.end)) {
    const last=result[result.length-1];
    if(last&&interval.start<=last.end) last.end=Math.max(last.end,interval.end);
    else result.push({...interval});
  }
  return result;
}

/** Only completed, account-bound receipts for this exact version and condition may contribute source spans. */
export function collectKnowledgeUseEvidence(actor:PostActor,request:KnowledgeEvidenceRequest,body:string) {
  const db=getUserSettingsDb();
  const knowledge=requireKnowledgeRow(actor,request.post_id);
  if(!knowledge.enabled||knowledge.post.status==='hidden') throw new PostError('참조 문서에 더 이상 접근할 수 없어.',403);
  const rows=db.prepare(`SELECT u.*,e.status AS execution_status,e.root_execution_id,e.account_key,e.finished_at,e.trust
    FROM post_evaluation_request_uses r JOIN post_knowledge_uses u ON u.id=r.use_id JOIN post_knowledge_executions e ON e.execution_id=u.execution_id
    WHERE r.request_id=? ORDER BY u.created_at,u.id`).all(request.id) as Array<KnowledgeUseRow&{execution_status:string;root_execution_id:string;account_key:string;finished_at:string|null;created_at:string;trust:string}>;
  if(!rows.length) throw new PostError('평가할 서버 참조를 찾을 수 없어.',410);
  const intervals:Array<{start:number;end:number}>=[],validRows:typeof rows=[];
  const time=(value:string)=>Date.parse(value.includes('T')?value:`${value.replace(' ','T')}Z`);
  for(const use of rows) {
    if(use.post_id!==request.post_id||use.content_version!==request.content_version||use.content_hash!==request.content_hash||use.scope!=='body'||use.comment_id!==null
      ||use.execution_id!==request.execution_id||use.account_key!==request.requester_account_key||use.root_execution_id!==request.root_execution_id
      ||(use.task_key??null)!==(request.task_key??null)) throw new PostError('다른 내용 판·실행·계정·댓글의 참조를 섞을 수 없어.',403);
    if(use.execution_status!=='completed'||use.trust!=='observed_execution'||!use.finished_at||time(use.created_at)>time(use.finished_at)) throw new PostError('종료를 확인하지 못한 실행 참조야.',409);
    if(use.evidence_expired||use.snapshot_body===null||Date.parse(use.expires_at)<=Date.now()) continue;
    if(use.snapshot_body!==body) throw new PostError('참조 원문이 내용 판과 일치하지 않아.',409);
    for(const interval of JSON.parse(use.intervals_json) as Array<{start:number;end:number}>) {
      if(!Number.isSafeInteger(interval.start)||!Number.isSafeInteger(interval.end)||interval.start<0||interval.end<=interval.start||interval.end>body.length) throw new PostError('참조 구간을 확인할 수 없어.',409);
      intervals.push(interval);
    }
    validRows.push(use);
  }
  if(!validRows.length) throw new PostError('참조 원문 보관 기간이 끝났어.',410);
  const merged=mergeKnowledgeIntervals(intervals),settings=loadPostsSettings().knowledge;
  let remaining=settings.maxInputCharacters;
  const segments:KnowledgeBodySegment[]=merged.slice(0,settings.maxSegmentsPerDocument).map(interval=>{
    const end=Math.min(interval.end,interval.start+remaining);remaining-=end-interval.start;
    return {scope:'body' as const,start:interval.start,end,text:body.slice(interval.start,end)};
  }).filter(segment=>segment.text.length);
  const executions=[...new Set(validRows.map(use=>use.execution_id))].map(id=>db.prepare('SELECT * FROM post_knowledge_executions WHERE execution_id=?').get(id) as KnowledgeExecutionRow);
  return {uses:validRows,executions,segments,truncated:segments.length<merged.length||segments.some((segment,index)=>segment.end<merged[index].end),
    coverageHash:knowledgeHash(JSON.stringify(segments.map(({start,end})=>({start,end}))))};
}
