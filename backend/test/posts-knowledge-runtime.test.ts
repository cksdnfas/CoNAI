import './support/testTemp'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('knowledge runtime: authenticated evidence, observed outcomes, atomic proposals and durable evaluation recovery', {timeout:60000}, async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'conai-knowledge-runtime-'));
  process.env.RUNTIME_BASE_PATH=root;process.env.RUNTIME_DATABASE_DIR=path.join(root,'database');process.env.RUNTIME_SAVE_DIR=path.join(root,'save');
  process.env.RUNTIME_UPLOADS_DIR=path.join(root,'uploads');
  const dbModule=await import('../src/database/userSettingsDb');dbModule.initializeUserSettingsDb();
  const db=dbModule.getUserSettingsDb();
  const {PostStore,PostCommentStore}=await import('../src/services/posts/postStore');
  const {KnowledgeStore}=await import('../src/services/posts/knowledgeStore');
  const {KnowledgeProposalStore}=await import('../src/services/posts/knowledge/knowledgeProposals');
  const runtime=await import('../src/services/posts/knowledge/knowledgeRuntime');
  const evaluation=await import('../src/services/posts/knowledge/knowledgeEvaluation');
  const {getKnowledgeQuality,knowledgeSearchTaskKey,knowledgeTaskFitMultiplier}=await import('../src/services/posts/knowledgeAssessment');
  const {updatePostsSettings}=await import('../src/services/posts/postsSettings');
  const {ChatProfileStore}=await import('../src/services/codex-chat/chatProfiles');
  const {CodexChatStore}=await import('../src/services/codex-chat/codexChatStore');
  const {ExternalApiProvider}=await import('../src/models/ExternalApiProvider');
  const {AuthAccount}=await import('../src/models/AuthAccount');
  const {AuthAccessControlService}=await import('../src/services/authAccessControlService');
  const {RuntimeJobRunner}=await import('../src/services/runtimeJobs/runtimeJobRunner');
  type Actor=import('../src/services/posts/postActor').PostActor;
  const permissions=['posts.view','posts.write','posts.comment','posts.evaluate','posts.knowledge.review','chat.use'];
  t.mock.method(AuthAccount,'findById',(id:number)=>({id,username:`account-${id}`,account_type:id===1?'admin':'guest',status:'active'}));
  t.mock.method(AuthAccessControlService,'resolveForAccountId',()=>({permissionKeys:permissions,groupKeys:[]}));
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unexpected network request');});
  const human:Actor={accountId:1,isAdmin:true,profileId:null,origin:'human',keys:new Set(permissions)};
  const other:Actor={accountId:2,isAdmin:false,profileId:null,origin:'human',keys:new Set(permissions)};
  const mcp:Actor={...human,origin:'mcp'};
  ExternalApiProvider.create({provider_name:'chat-runtime',display_name:'Original',provider_type:'llm_openai_compatible',base_url:'http://chat.invalid/v1',is_enabled:true,additional_config:{default_model:'model-1'}});
  ExternalApiProvider.create({provider_name:'judge-runtime',display_name:'Judge',provider_type:'decision_typesafe',base_url:'https://judge.invalid',is_enabled:true});
  const profile=ChatProfileStore.create({name:'Reader',engine:'llm',providerName:'chat-runtime',model:'model-1'});
  const clone=ChatProfileStore.create({name:'Display name changed',engine:'llm',providerName:'chat-runtime',model:'model-1'});
  const bot:Actor={...human,origin:'chat',profileId:profile.id};
  const document=(title:string,body='A documented command is incorrect.\nSecond paragraph.')=>{
    const created=PostStore.create(human,{title,body});return KnowledgeStore.patch(human,created.id,{expectedRevision:created.revision,enabled:true,sources:[]});
  };
  const execution=(replyId:string,p=profile)=>{
    const threadId=CodexChatStore.createThread(1,'Private task','llm',p.id);
    const sourceId=CodexChatStore.addMessage({thread_id:threadId,role:'user',content:'PRIVATE TASK MUST NEVER REACH A PUBLIC REASON',tool_calls:[],status:'completed',error:null});
    const chat={threadId,profileId:p.id,kind:'direct' as const,replyId,rootExecutionId:`chat:${threadId}:user:${sourceId}`};
    return {context:runtime.knowledgeExecutionFromChat({accountId:1,accountType:'admin'},chat),chat};
  };
  const read=(post:ReturnType<typeof document>,context:import('../src/services/posts/knowledge/knowledgeRuntime').KnowledgeExecutionContext,actor=bot,commentId?:number)=>{
    const body=commentId?PostCommentStore.get(actor,commentId).body:post.body;
    return runtime.recordKnowledgeUse(actor,{postId:post.id,commentId,body,intervals:[{start:0,end:body.length}],execution:context})!;
  };
  const assess=(reference:ReturnType<typeof read>,context:import('../src/services/posts/knowledge/knowledgeRuntime').KnowledgeExecutionContext,key:string,patch:Partial<import('@conai/shared').PostKnowledgeAssessmentInput>={})=>runtime.submitKnowledgeAssessment(bot,context,{
    useId:reference.useId,referenceToken:reference.referenceToken,stage:'final',quality:'down',taskFit:'unknown',reasonCode:'error',
    evidence:[{scope:reference.scope,start:0,end:1,quote:reference.scope==='body'?'A':'C'}],idempotencyKey:key,...patch});
  const waitFor=async(check:()=>boolean)=>{for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Durable evaluation did not settle');};
  t.after(async()=>{
    evaluation.shutdownKnowledgeEvaluationRuntime();RuntimeJobRunner.shutdown();
    dbModule.closeUserSettingsDb();(await import('../src/database/init')).closeDatabase();
    const {logger}=await import('../src/utils/logger');await new Promise<void>(resolve=>logger.close(resolve));
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('conai-knowledge-runtime-'));
    await fs.promises.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});
  });

  await t.test('read tokens bind account, execution, model and exact returned intervals; old versions retain their identity',()=>{
    const post=document('Read evidence'),{context}=execution('evidence-reply'),reference=read(post,context);
    assert.equal(reference.contentVersion,1);
    assert.throws(()=>assess(reference,context,'forged',{referenceToken:'invented'}),{status:403});
    assert.throws(()=>assess(reference,{...context,model:'pretended'},'model-forgery'),{status:403});
    assert.throws(()=>runtime.submitKnowledgeAssessment(other,context,{useId:reference.useId,referenceToken:reference.referenceToken,stage:'final',quality:'abstain',taskFit:'unknown',reasonCode:'uncertain',evidence:[],idempotencyKey:'account-forgery'}),{status:403});
    assert.throws(()=>assess(reference,context,'quote-forgery',{evidence:[{scope:'body',start:0,end:1,quote:'Z'}]}),{status:400});
    const partial=runtime.recordKnowledgeUse(bot,{postId:post.id,body:post.body.slice(0,1),intervals:[{start:0,end:1}],execution:context})!;
    assert.throws(()=>assess(partial,context,'out-of-scope',{evidence:[{scope:'body',start:1,end:2,quote:post.body.slice(1,2)}]}),{status:400});
    const saved=assess(reference,context,'old-version');assert.equal(saved.phase,'provisional');
    PostStore.update(human,post.id,{body:'New correct instructions.',expectedRevision:post.revision});
    runtime.finishKnowledgeExecution(context,{status:'completed'});
    const event=db.prepare("SELECT content_version,quality,phase FROM post_assessment_events WHERE use_id=? ORDER BY id DESC LIMIT 1").get(reference.useId) as {content_version:number;quality:string;phase:string};
    assert.deepEqual(event,{content_version:1,quality:'down',phase:'final'});
    assert.equal(getKnowledgeQuality(human,post.id).current.useAi.down,0,'old-content feedback is not a new vote on current content');
    assert.equal(assess(reference,context,'old-version').eventId,(db.prepare('SELECT event_id FROM post_knowledge_use_assessments WHERE id=?').get(saved.assessmentId) as {event_id:number}).event_id);
  });

  await t.test('successful response alone, failure, self review and comment-only reads never create global quality votes',()=>{
    const post=document('Outcome is not success'),{context}=execution('success-reply'),reference=read(post,context);
    assess(reference,context,'claimed-help',{quality:'up',taskFit:'useful',reasonCode:'helpful'});
    runtime.finishKnowledgeExecution(context,{status:'completed'});
    assert.equal(getKnowledgeQuality(human,post.id).up,0);
    const failed=execution('failed-reply').context,failedRef=read(post,failed);assess(failedRef,failed,'failed');runtime.finishKnowledgeExecution(failed,{status:'failed'});
    assert.equal(getKnowledgeQuality(human,post.id).down,0);
    const comment=PostCommentStore.create(human,post.id,{body:'Comment is discussion, not a body assertion.'});
    const fromComment=execution('comment-reply').context,commentRef=read(post,fromComment,bot,comment.id);assess(commentRef,fromComment,'comment');runtime.finishKnowledgeExecution(fromComment,{status:'completed'});
    assert.equal(getKnowledgeQuality(human,post.id).down,0);
    const selfPost=PostStore.create(bot,{title:'Self authored',body:post.body});
    const self=document('Other source');
    const designated=KnowledgeStore.patch(human,selfPost.id,{expectedRevision:selfPost.revision,enabled:true,sources:[{kind:'post',postId:self.id} as any]});
    const selfContext=execution('self-reply').context;const selfRef=read(designated,selfContext);assess(selfRef,selfContext,'self');runtime.finishKnowledgeExecution(selfContext,{status:'completed'});
    assert.equal(getKnowledgeQuality(human,designated.id).down,0);
  });

  await t.test('a final old draft assessment cannot publish private evidence after a different version is published',()=>{
    const created=PostStore.create(human,{title:'Private version',body:'A PRIVATE DRAFT SECRET',status:'draft'});
    const post=KnowledgeStore.patch(human,created.id,{expectedRevision:created.revision,enabled:true,sources:[]});
    const {context}=execution('private-version-final'),reference=read(post,context);
    assess(reference,context,'private-final',{evidence:[{scope:'body',start:0,end:post.body.length,quote:post.body}]});
    PostStore.update(human,post.id,{body:'Published different instructions.',status:'published',expectedRevision:post.revision});
    runtime.finishKnowledgeExecution(context,{status:'completed'});
    const published=getKnowledgeQuality(other,post.id);
    assert.equal(published.reasons.some(reason=>reason.evidenceQuote.includes('PRIVATE DRAFT SECRET')),false);
    assert.equal(published.history.down,0);
    assert.equal((db.prepare("SELECT public_reason FROM post_assessment_events WHERE use_id=? AND phase='final'").get(reference.useId) as {public_reason:number}).public_reason,0);
  });

  await t.test('external MCP claims remain unverified and cloned profiles share one evaluator family',()=>{
    const original=execution('original').context,copy=execution('copy',clone).context;
    assert.equal(original.evaluatorFamily,copy.evaluatorFamily);
    const post=document('External trust'),context=runtime.knowledgeExecutionFromMcp({scopes:['read','organize'],source:'http',keyId:'server-owned-key',requester:{accountId:1,accountType:'admin'}});
    const reference=read(post,context,mcp);
    runtime.submitKnowledgeAssessment(mcp,context,{useId:reference.useId,referenceToken:reference.referenceToken,stage:'final',quality:'down',taskFit:'unknown',reasonCode:'error',evidence:[{scope:'body',start:0,end:1,quote:'A'}],idempotencyKey:'external'});
    runtime.finishKnowledgeExecution(context,{status:'completed',observedOutcome:'succeeded'});
    assert.equal(getKnowledgeQuality(human,post.id).down,0);assert.equal(reference.trust,'external_unverified');
  });

  await t.test('task fit is bound to the actual normalized search and account; search summaries alone are not read proof',()=>{
    const post=document('Condition-scoped task fit'),{context}=execution('task-query');
    runtime.recordKnowledgeSearch(context,' Windows  오류 ',[post.id]);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM post_knowledge_uses WHERE execution_id=?').get(context.executionId) as {n:number}).n,0);
    const reference=read(post,context);
    const key=(db.prepare('SELECT task_key FROM post_knowledge_uses WHERE id=?').get(reference.useId) as {task_key:string}).task_key;
    assert.equal(key,knowledgeSearchTaskKey('windows 오류'));assert.equal(key,knowledgeSearchTaskKey('WINDOWS\t오류'));
    assert.notEqual(key,knowledgeSearchTaskKey('Linux 오류'));assert.equal(key.includes('오류'),false,'private queries are stored only as a condition digest');
    assess(reference,context,'bad-fit',{stage:'provisional',quality:'abstain',taskFit:'unsuitable',reasonCode:'scope_mismatch'});
    assert.ok(knowledgeTaskFitMultiplier(human,post.id,key,context.rootExecutionId)<1);
    assert.equal(knowledgeTaskFitMultiplier(human,post.id,key),1,'provisional fit cannot transfer to another execution');
    assess(reference,context,'final-fit',{quality:'abstain',taskFit:'unsuitable',reasonCode:'scope_mismatch'});runtime.finishKnowledgeExecution(context,{status:'completed'});
    assert.ok(knowledgeTaskFitMultiplier(human,post.id,knowledgeSearchTaskKey(' WINDOWS  오류 '))<1);
    assert.equal(knowledgeTaskFitMultiplier(other,post.id,key),1);
    assert.equal(knowledgeTaskFitMultiplier(human,post.id,knowledgeSearchTaskKey('Linux 오류'),context.rootExecutionId),1);
    assert.equal(getKnowledgeQuality(human,post.id).down,0,'scope mismatch never becomes global document quality');
  });

  await t.test('a later comment assessment cannot supersede the body opinion from the same execution',()=>{
    const post=document('Body and comment distinct'),{context}=execution('same-execution-scopes'),body=read(post,context);
    const comment=PostCommentStore.create(human,post.id,{body:'Comment discussion.'}),discussion=read(post,context,bot,comment.id);
    assess(body,context,'body-down');assess(discussion,context,'comment-abstain');runtime.finishKnowledgeExecution(context,{status:'completed'});
    assert.equal(getKnowledgeQuality(human,post.id).current.useAi.down,0.25);
    const heads=db.prepare('SELECT e.purpose,e.quality FROM post_assessment_heads h JOIN post_assessment_events e ON e.id=h.event_id WHERE e.post_id=? ORDER BY e.id').all(post.id) as Array<{purpose:string;quality:string}>;
    assert.deepEqual(heads,[{purpose:'usage',quality:'down'},{purpose:`comment_usage:${comment.id}`,quality:'abstain'}]);
  });

  await t.test('proposal application requires a human, applies body and sources once, and preserves conflicts and private source boundaries',()=>{
    const source=document('Public source'),target=document('Proposal target');
    const proposal=KnowledgeProposalStore.create(bot,{kind:'update',postId:target.id,baseRevision:target.revision,baseContentVersion:target.knowledge!.contentVersion,
      title:target.title,body:'Updated knowledge body.',sources:[{kind:'post',postId:source.id} as any],reason:'Source-backed correction',idempotencyKey:'proposal'});
    assert.throws(()=>KnowledgeProposalStore.apply(mcp,proposal.id,{expectedRevision:target.revision,contentVersion:target.knowledge!.contentVersion}),{status:403});
    const applied=KnowledgeProposalStore.apply(human,proposal.id,{expectedRevision:target.revision,contentVersion:target.knowledge!.contentVersion});
    assert.equal(applied.status,'applied');assert.equal(PostStore.get(human,target.id).revision,target.revision+1);
    assert.equal(applied.appliedContentVersion,2);assert.equal(KnowledgeProposalStore.apply(human,proposal.id,{}).appliedRevision,applied.appliedRevision);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM post_knowledge_versions WHERE post_id=?').get(target.id) as {n:number}).n,2);
    const current=PostStore.get(human,target.id);
    const stale=KnowledgeProposalStore.create(bot,{kind:'update',postId:target.id,baseRevision:current.revision,baseContentVersion:current.knowledge!.contentVersion,title:current.title,body:'Stale draft',sources:[],idempotencyKey:'stale'});
    PostStore.update(human,target.id,{body:'Concurrent update',expectedRevision:current.revision});
    assert.throws(()=>KnowledgeProposalStore.apply(human,stale.id,{expectedRevision:stale.baseRevision,contentVersion:stale.baseContentVersion}),{status:409});
    assert.equal(KnowledgeProposalStore.get(human,stale.id).status,'pending');
    const privatePost=PostStore.create(human,{title:'Private source',body:'PRIVATE SECRET',status:'draft'});
    assert.throws(()=>KnowledgeProposalStore.create(bot,{kind:'create',title:'Expose',body:'PRIVATE SECRET',status:'published',sources:[{kind:'post',postId:privatePost.id,quote:'PRIVATE SECRET'} as any],idempotencyKey:'expose'}),{status:403});
    const draft=KnowledgeProposalStore.create(bot,{kind:'create',title:'Private draft',body:'Private summary',sources:[{kind:'post',postId:privatePost.id} as any],idempotencyKey:'private-draft'});
    assert.equal(draft.proposedPostStatus,'draft');assert.throws(()=>KnowledgeProposalStore.get(other,draft.id),{status:404});
    const created=KnowledgeProposalStore.apply(human,draft.id);assert.equal(PostStore.get(human,created.appliedPostId!).status,'draft');
  });

  await t.test('evaluation is off by default; lease recovery and cancellation never manufacture adverse votes',()=>{
    const post=document('Disabled evaluation');
    const request=evaluation.KnowledgeEvaluationStore.request(human,post.id,{contentVersion:1,idempotencyKey:'disabled'});
    assert.equal(request.status,'skipped');assert.equal(request.reasonCode,'evaluation_disabled');
    assert.throws(()=>evaluation.KnowledgeEvaluationStore.request(bot,post.id,{contentVersion:1,idempotencyKey:'ai-review'}),{status:403});
    db.prepare("UPDATE post_evaluation_requests SET status='running',attempts=1,lease_token='lost',lease_until=datetime('now','-1 minute') WHERE id=?").run(request.id);
    assert.equal(evaluation.recoverKnowledgeEvaluationRequests(),1);
    assert.equal(evaluation.KnowledgeEvaluationStore.list(human,post.id)[0].status,'queued');
    assert.equal(evaluation.KnowledgeEvaluationStore.cancel(human,post.id,request.id).status,'cancelled');
    assert.equal(getKnowledgeQuality(human,post.id).down,0);
  });

  await t.test('the selected judge records actual tokens and old versions, excludes private tasks, and obeys daily call limits',async(s)=>{
    let calls=0,resolveResponse:((response:Response)=>void)|null=null,captured:any;
    s.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
      calls++;captured=JSON.parse(String(init?.body));return await new Promise<Response>(resolve=>{resolveResponse=resolve;});
    });
    updatePostsSettings({knowledge:{autoEvaluationEnabled:true,judgeProvider:'judge-runtime',judgeModel:'jev-test',dailyCallLimit:20,dailyTokenLimit:50000}});
    evaluation.registerKnowledgeEvaluationHandler();evaluation.initializeKnowledgeEvaluationRuntime();
    const post=document('Judge actual tokens');
    const request=evaluation.KnowledgeEvaluationStore.request(human,post.id,{contentVersion:1,idempotencyKey:'judge'});
    await waitFor(()=>resolveResponse!==null);
    assert.equal(JSON.stringify(captured).includes('PRIVATE TASK MUST NEVER REACH A PUBLIC REASON'),false);
    assert.equal(captured.state.taskContextAvailable,false);assert.equal(captured.model,'jev-test');
    PostStore.update(human,post.id,{body:'Current corrected body',expectedRevision:post.revision});
    resolveResponse!(Response.json({model:'jev-test',usage:{input_tokens:120,output_tokens:30},answers:{
      quality:{type:'choice',choice:'down',probabilities:{down:0.95,up:0.025,abstain:0.025}},
      task_fit:{type:'choice',choice:'unknown',probabilities:{unknown:1}},
      reason_code:{type:'choice',choice:'error',probabilities:{error:1}},evidence_sufficient:{type:'choice',choice:'yes',probabilities:{yes:0.95,no:0.05}},
    }}));
    await waitFor(()=>evaluation.KnowledgeEvaluationStore.list(human,post.id)[0].status==='completed');
    const final=evaluation.KnowledgeEvaluationStore.list(human,post.id)[0];assert.equal(final.totalTokens,150);
    const event=db.prepare('SELECT content_version,quality FROM post_assessment_events WHERE request_id=?').get(request.id) as {content_version:number;quality:string};
    assert.deepEqual(event,{content_version:1,quality:'down'});assert.equal(getKnowledgeQuality(human,post.id).current.judge.down,0);
    updatePostsSettings({knowledge:{dailyCallLimit:1}});
    const capped=document('Capped judge'),cap=evaluation.KnowledgeEvaluationStore.request(human,capped.id,{contentVersion:1,idempotencyKey:'cap'});
    await waitFor(()=>evaluation.KnowledgeEvaluationStore.list(human,capped.id)[0].status==='skipped');
    assert.equal(evaluation.KnowledgeEvaluationStore.list(human,capped.id)[0].reasonCode,'daily_budget');assert.equal(calls,1);
    assert.equal(evaluation.KnowledgeEvaluationStore.status(human).todayTokens,150);
    assert.equal(evaluation.KnowledgeEvaluationStore.cancel(human,capped.id,cap.id).status,'skipped');
    evaluation.shutdownKnowledgeEvaluationRuntime();
  });

  await t.test('source visibility revoked during a model call discards the opinion and keeps actual usage',async(s)=>{
    let resolveResponse:((response:Response)=>void)|null=null;
    s.mock.method(globalThis,'fetch',async()=>await new Promise<Response>(resolve=>{resolveResponse=resolve;}));
    updatePostsSettings({knowledge:{dailyCallLimit:20,dailyTokenLimit:50000}});
    evaluation.initializeKnowledgeEvaluationRuntime();
    const source=document('Source to revoke'),target=document('Dependent review');
    const linked=KnowledgeStore.patch(human,target.id,{expectedRevision:target.revision,sources:[{kind:'post',postId:source.id} as any]});
    const request=evaluation.KnowledgeEvaluationStore.request(human,linked.id,{contentVersion:linked.knowledge!.contentVersion,idempotencyKey:'revoke-source'});
    await waitFor(()=>resolveResponse!==null);
    PostStore.update(human,source.id,{status:'hidden',expectedRevision:source.revision});
    resolveResponse!(Response.json({model:'jev-test',usage:{input_tokens:90,output_tokens:20},answers:{
      quality:{type:'choice',choice:'down',probabilities:{down:1}},reason_code:{type:'choice',choice:'error',probabilities:{error:1}},
      task_fit:{type:'choice',choice:'unknown',probabilities:{unknown:1}},evidence_sufficient:{type:'choice',choice:'yes',probabilities:{yes:1}},
    }}));
    await waitFor(()=>evaluation.KnowledgeEvaluationStore.list(human,linked.id)[0].status==='skipped');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM post_assessment_events WHERE request_id=?').get(request.id) as {n:number}).n,0);
    assert.equal(evaluation.KnowledgeEvaluationStore.list(human,linked.id)[0].totalTokens,110);
    evaluation.shutdownKnowledgeEvaluationRuntime();
  });

  await t.test('SQLite backup and reopen preserve versions, proposals, reference identities, outbox and a rebuildable ledger',async()=>{
    const post=document('Restore ledger'),{context}=execution('restore-reply'),reference=read(post,context);
    assess(reference,context,'restore-vote');runtime.finishKnowledgeExecution(context,{status:'completed'});
    const before=getKnowledgeQuality(human,post.id);
    const tableNames=['post_knowledge_versions','post_knowledge_proposals','post_knowledge_uses','post_knowledge_executions','post_knowledge_searches','post_assessment_events','post_assessment_heads','post_evaluation_requests','post_evaluation_usage'];
    const counts=new Map(tableNames.map(name=>[name,(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as {n:number}).n]));
    const originalPath=db.name,snapshot=path.join(root,'knowledge-backup.db');
    await db.backup(snapshot);
    dbModule.closeUserSettingsDb();fs.copyFileSync(snapshot,originalPath);dbModule.initializeUserSettingsDb();
    const reopened=dbModule.getUserSettingsDb();
    for(const name of tableNames) assert.equal((reopened.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as {n:number}).n,counts.get(name),name);
    reopened.prepare('DELETE FROM post_quality_stats').run();
    const rebuilt=getKnowledgeQuality(human,post.id);assert.equal(rebuilt.down,before.down);assert.equal(rebuilt.qualityMultiplier,before.qualityMultiplier);
    assert.equal(rebuilt.current.useAi.effectiveWeight,before.current.useAi.effectiveWeight);
    const token=reopened.prepare('SELECT token_hash,snapshot_body FROM post_knowledge_uses WHERE id=?').get(reference.useId) as {token_hash:string;snapshot_body:string};
    assert.equal(token.token_hash,runtime.knowledgeHash(reference.referenceToken));assert.equal(token.snapshot_body,post.body);
  });
});
