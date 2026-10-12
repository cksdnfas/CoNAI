import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostAssessmentQuality, PostDetail, PostQualityGroup, PostReviewIssue } from '@conai/shared'
import { BookOpen, Download, Ellipsis, Link as LinkIcon, Pencil, ThumbsDown, ThumbsUp, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, cancelPostVote, exportPostKnowledge, getPostKnowledgeLinks, getPostQuality, getPostsSettings, listPostKnowledgeReviewQueue, reviewPost, updatePostKnowledge, votePost } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { KnowledgeSources, KnowledgeSourcesEditor } from './post-knowledge-sources'
import { PostKnowledgeProposals, KnowledgeProposalEditor } from './post-knowledge-proposals'
import { PostKnowledgeEvaluations } from './post-knowledge-evaluations'
import { PostKnowledgeStatus } from './post-knowledge-status'
import { postRoute } from './post-links'
import { usePostPermissions } from './use-post-permissions'
import { PostKnowledgeTaskFit, type KnowledgeSearchContext } from './post-knowledge-task-fit'
import { PostKnowledgeAssessmentAudit } from './post-knowledge-assessments'

const reasons = [
  { value: 'error', ko: '오류', en: 'Error' },
  { value: 'outdated', ko: '오래된 정보', en: 'Outdated information' },
  { value: 'insufficient_evidence', ko: '근거·설명 부족', en: 'Missing evidence or explanation' },
  { value: 'reproduction_failed', ko: '재현 실패', en: 'Could not reproduce' },
  { value: 'helpful', ko: '해결에 기여', en: 'Helped solve the task' },
  { value: 'scope_mismatch', ko: '작업에 맞지 않음', en: 'Did not fit the task' },
] as const

function KnowledgeMetadataEditor({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [sources, setSources] = useState(post.knowledgeSources ?? [])
  const save = useMutation({
    mutationFn: () => updatePostKnowledge(post.id, { expectedRevision: post.revision, sources }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '출처를 저장하지 못했어.', en: 'Could not save sources.' })) }),
  })
  return (
    <Modal open onClose={onClose} title={t({ ko: '문서 출처', en: 'Document sources' })} size="normal" dirty={JSON.stringify(sources) !== JSON.stringify(post.knowledgeSources ?? [])} onSave={() => { if (!save.isPending) save.mutate() }}>
      <ModalBody><KnowledgeSourcesEditor sources={sources} onChange={setSources} /></ModalBody>
      <ModalFooter><Button variant="ghost" onClick={onClose}>{t({ ko: '닫기', en: 'Close' })}</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>{t({ ko: '저장', en: 'Save' })}</Button></ModalFooter>
    </Modal>
  )
}

function KnowledgeVoteDialog({ post, quality, onClose }: { post: PostDetail; quality: 'up' | 'down'; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [reasonCode, setReasonCode] = useState('')
  const [reason, setReason] = useState('')
  const [quote, setQuote] = useState('')
  const save = useMutation({
    mutationFn: (idempotencyKey: string) => votePost(post.id, {
      contentVersion: post.knowledge!.contentVersion, idempotencyKey,
      quality,
      ...(reasonCode ? { reasonCode } : {}), reason, evidenceQuote: quote,
    }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '의견을 저장하지 못했어.', en: 'Could not save the vote.' })) }),
  })
  return (
    <Modal open onClose={onClose} title={quality === 'up' ? t({ ko: '추천', en: 'Recommend' }) : t({ ko: '비추천', en: 'Do not recommend' })} size="narrow">
      <ModalBody>
        <p className="text-sm text-muted-foreground">{t({ ko: '현재 내용 {version}판에 의견을 남겨.', en: 'Leave feedback on content version {version}.' }, { version: post.knowledge!.contentVersion })}</p>
        <Field label={t({ ko: '이유 (선택)', en: 'Reason (optional)' })}><Select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="">{t({ ko: '선택 안 함', en: 'None' })}</option>{reasons.filter((item) => item.value !== 'scope_mismatch').map((item) => <option key={item.value} value={item.value}>{t(item)}</option>)}</Select></Field>
        <Field label={t({ ko: '설명 (선택)', en: 'Explanation (optional)' })}><Textarea rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <Field label={t({ ko: '문서에서 인용 (선택)', en: 'Quote from the document (optional)' })}><Textarea rows={2} maxLength={2000} value={quote} onChange={(event) => setQuote(event.target.value)} /></Field>
      </ModalBody>
      <ModalFooter><Button variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button><Button disabled={save.isPending} onClick={() => save.mutate(crypto.randomUUID())}>{t({ ko: '의견 저장', en: 'Save feedback' })}</Button></ModalFooter>
    </Modal>
  )
}

function KnowledgeReviewDialog({ post, action, issue, onClose }: { post: PostDetail; action: 'verify' | 'request_review' | 'report_error' | 'resolve_issue'; issue?: PostReviewIssue; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [quote, setQuote] = useState('')
  const title = action === 'verify' ? t({ ko: '현재 판 검증', en: 'Verify current version' }) : action === 'resolve_issue' ? t({ ko: '문제 해결 확인', en: 'Resolve issue' }) : action === 'report_error' ? t({ ko: '오류 제보', en: 'Report an error' }) : t({ ko: '재검토 요청', en: 'Request review' })
  const save = useMutation({
    mutationFn: () => reviewPost(post.id, { contentVersion: post.knowledge!.contentVersion, action, reason, evidenceQuote: quote, ...(issue ? { issueId: issue.id } : {}) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '검토를 저장하지 못했어.', en: 'Could not save the review.' })) }),
  })
  return (
    <Modal open onClose={onClose} title={title} size="narrow">
      <ModalBody>
        <PostKnowledgeStatus knowledge={post.knowledge} showVersion />
        {issue ? <p className="whitespace-pre-wrap text-sm">{issue.reason}</p> : null}
        <Field label={action === 'resolve_issue' ? t({ ko: '해결 근거', en: 'Resolution evidence' }) : t({ ko: '검토 이유', en: 'Review reason' })}><Textarea rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <Field label={t({ ko: '문서에서 인용 (선택)', en: 'Quote from the document (optional)' })}><Textarea rows={2} maxLength={2000} value={quote} onChange={(event) => setQuote(event.target.value)} /></Field>
      </ModalBody>
      <ModalFooter><Button variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button><Button disabled={!reason.trim() || save.isPending} onClick={() => save.mutate()}>{title}</Button></ModalFooter>
    </Modal>
  )
}

function QualityRow({ label, group }: { label: string; group: PostQualityGroup }) {
  return <tr className="border-b border-line last:border-0"><th scope="row" className="py-2 pr-3 text-left font-medium">{label}</th><td className="px-2 py-2 tabular-nums">{group.up} / {group.down} / {group.abstain}</td><td className="px-2 py-2 tabular-nums">{group.rawCount}</td><td className="px-2 py-2 tabular-nums">{group.independentCount}</td><td className="py-2 pl-2 tabular-nums">{group.effectiveWeight.toFixed(2)}</td></tr>
}

/** Public document evidence and feedback only; execution context never enters this component. */
export function PostKnowledgePanel({ post, searchContext }: { post: PostDetail; searchContext: KnowledgeSearchContext | null }) {
  const { t, formatDateTime } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = usePostPermissions()
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const settings = useQuery({ queryKey: ['post-settings'], queryFn: getPostsSettings, staleTime: 60_000 })
  const featureEnabled = settings.data?.knowledge.enabled !== false
  const enabled = post.knowledge?.enabled === true
  const active = enabled && !post.knowledge?.deletedAt && featureEnabled
  const links = useQuery({ queryKey: [POSTS_QUERY_KEY, 'links', post.id, post.revision], queryFn: () => getPostKnowledgeLinks(post.id), enabled: active && expanded })
  const quality = useQuery({ queryKey: [POSTS_QUERY_KEY, 'quality', permissions.viewerKey, post.id, post.knowledge?.contentVersion], queryFn: () => getPostQuality(post.id), enabled: active })
  const queue = useQuery({ queryKey: [POSTS_QUERY_KEY, 'review-queue'], queryFn: listPostKnowledgeReviewQueue, enabled: active && expanded && post.knowledge?.canReview === true })
  const issues = queue.data?.items.find((item) => item.post.id === post.id)?.issues ?? []
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  const [review, setReview] = useState<{ action: 'verify' | 'request_review' | 'report_error' | 'resolve_issue'; issue?: PostReviewIssue } | null>(null)
  const [proposalMode, setProposalMode] = useState<'create' | 'update' | null>(null)
  const change = useMutation({
    mutationFn: (nextEnabled: boolean) => updatePostKnowledge(post.id, { expectedRevision: post.revision, enabled: nextEnabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '지식 지정을 바꾸지 못했어.', en: 'Could not change knowledge status.' })) }),
  })
  const cancelVote = useMutation({
    mutationFn: () => cancelPostVote(post.id, post.knowledge!.contentVersion, crypto.randomUUID()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '의견을 취소하지 못했어.', en: 'Could not cancel the vote.' })) }),
  })
  const download = useMutation({
    mutationFn: () => exportPostKnowledge(post.id),
    onSuccess: (manifest) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `knowledge-${post.id}-v${manifest.contentVersion}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '문서를 내보내지 못했어.', en: 'Could not export the document.' })) }),
  })
  if (!featureEnabled || post.knowledge?.deletedAt) return null
  const stats = quality.data
  const ownQuality: PostAssessmentQuality | undefined = stats?.ownVote?.quality
  const hasOpinion = Boolean(stats?.ownVote && (stats.ownVote.quality !== 'abstain' || stats.ownVote.taskFit !== 'unknown'))
  const score = stats ? Number((stats.up - stats.down).toFixed(2)) : 0
  return (
    <footer className="border-t border-line pt-3" aria-label={t({ ko: '게시물 평가', en: 'Post feedback' })}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm tabular-nums">
          {active && quality.isPending ? <span className="text-muted-foreground">{t({ ko: '평가 불러오는 중…', en: 'Loading feedback…' })}</span>
            : active && quality.isError ? <Button variant="ghost" size="xs" onClick={() => void quality.refetch()}>{t({ ko: '평가 다시 불러오기', en: 'Retry feedback' })}</Button>
            : active && stats && (stats.up + stats.down > 0 || stats.sampleCount > 0) ? <span className="font-medium">{t({ ko: '평가 {score}점', en: 'Score {score}' }, { score: `${score > 0 ? '+' : ''}${score}` })}</span>
            : <span className="text-muted-foreground">{t({ ko: '아직 평가 없음', en: 'No feedback yet' })}</span>}
        </div>
        {active && stats && !quality.isError ? <>
          <Button variant={ownQuality === 'up' ? 'secondary' : 'ghost'} size="sm" disabled={!post.knowledge?.canEvaluate} aria-pressed={ownQuality === 'up'} aria-label={t({ ko: '추천 {score}점', en: 'Recommend, {score} points' }, { score: Number(stats.up.toFixed(2)) })} onClick={() => setVote('up')}><ThumbsUp />{Number(stats.up.toFixed(2))}</Button>
          <Button variant={ownQuality === 'down' ? 'secondary' : 'ghost'} size="sm" disabled={!post.knowledge?.canEvaluate} aria-pressed={ownQuality === 'down'} aria-label={t({ ko: '비추천 {score}점', en: 'Do not recommend, {score} points' }, { score: Number(stats.down.toFixed(2)) })} onClick={() => setVote('down')}><ThumbsDown />{Number(stats.down.toFixed(2))}</Button>
        </> : null}
        <IconButton variant="ghost" size="icon-sm" label={expanded ? t({ ko: '평가 상세 접기', en: 'Collapse feedback details' }) : t({ ko: '평가 상세 보기', en: 'Show feedback details' })} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((current) => !current)}><Ellipsis /></IconButton>
      </div>
      <div id={detailsId} hidden={!expanded} className="space-y-6 pt-5">
      {expanded ? <>
      <Section heading={t({ ko: '지식 문서', en: 'Knowledge document' })} actions={(
        <>
          {post.canEdit ? <Button variant="ghost" size="sm" disabled={change.isPending} onClick={async () => {
            if (!enabled || await confirm({ title: t({ ko: '지식 문서 지정을 해제할까?', en: 'Remove knowledge designation?' }), description: t({ ko: '저장한 판과 평가 이력은 보존돼.', en: 'Saved versions and feedback remain available.' }) })) change.mutate(!enabled)
          }}><BookOpen />{enabled ? t({ ko: '지식 지정 해제', en: 'Remove designation' }) : t({ ko: '지식으로 지정', en: 'Designate as knowledge' })}</Button> : null}
          {permissions.canWrite ? <Button variant="secondary" size="sm" onClick={() => setProposalMode('create')}>{t({ ko: '이 글·댓글로 문서 초안', en: 'Draft from this post and comments' })}</Button> : null}
          {enabled && permissions.canWrite ? <Button variant="ghost" size="sm" onClick={() => setProposalMode('update')}>{t({ ko: '수정 제안', en: 'Suggest a change' })}</Button> : null}
        </>
      )}>
        {enabled ? <PostKnowledgeStatus knowledge={post.knowledge} showVersion /> : <p className="text-sm text-muted-foreground">{t({ ko: '유용한 글을 지식 문서로 지정해 다시 찾아 쓸 수 있어.', en: 'Designate useful posts as knowledge to find and reuse them.' })}</p>}
      </Section>
      {active ? <>
        <Section heading={t({ ko: '현재 판 평가', en: 'Feedback on the current version' })} actions={post.knowledge?.canEvaluate ? <>
          {hasOpinion ? <Button variant="ghost" size="sm" disabled={cancelVote.isPending} onClick={() => cancelVote.mutate()}><Undo2 />{t({ ko: '의견 취소', en: 'Cancel feedback' })}</Button> : null}
        </> : undefined}>
          {quality.isPending ? <LoadingState /> : quality.isError ? <ErrorState size="compact" error={quality.error} onRetry={() => void quality.refetch()} /> : stats ? <>
            <p className="text-xs text-muted-foreground">{t({ ko: '점수는 추천에서 비추천을 뺀 값이야. 사람·AI 평가와 이전 판의 가중치를 반영해.', en: 'The score is recommendations minus negative feedback, weighted across people, AI and earlier versions.' })}</p>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr className="border-b border-line"><th scope="col" className="py-2 text-left">{t({ ko: '평가자', en: 'Evaluator' })}</th><th scope="col" className="px-2 py-2 text-left">{t({ ko: '추천 / 비추천 / 기권', en: 'Up / down / abstain' })}</th><th scope="col" className="px-2 py-2 text-left">{t({ ko: '기록', en: 'Records' })}</th><th scope="col" className="px-2 py-2 text-left">{t({ ko: '독립 근거', en: 'Independent evidence' })}</th><th scope="col" className="py-2 pl-2 text-left">{t({ ko: '유효 기여', en: 'Effective weight' })}</th></tr></thead><tbody><QualityRow label={t({ ko: '사람', en: 'People' })} group={stats.current.human} /><QualityRow label={t({ ko: '사용 AI', en: 'AI using the document' })} group={stats.current.useAi} /><QualityRow label={t({ ko: '판단모델', en: 'Judge model' })} group={stats.current.judge} /></tbody></table></div>
            <p className="text-xs text-muted-foreground">{t({ ko: '이전 판 참고: 추천 {up}, 비추천 {down}, 유효 기여 {weight}', en: 'Earlier versions: up {up}, down {down}, effective weight {weight}' }, { up: stats.history.up.toFixed(2), down: stats.history.down.toFixed(2), weight: stats.history.effectiveWeight.toFixed(2) })}</p>
            <p className="text-xs text-muted-foreground">{t({ ko: '참조 우선도 배율 {multiplier} · 자동 평가 기여 {weight}/{cap} · 정책 {policy}', en: 'Reference priority multiplier {multiplier} · automatic weight {weight}/{cap} · policy {policy}' }, { multiplier: stats.qualityMultiplier.toFixed(3), weight: stats.aiEffectiveWeight.toFixed(2), cap: stats.aiCap.toFixed(2), policy: stats.policyVersion })}</p>
            {stats.reasons.length ? <details><summary className="cursor-pointer text-sm text-muted-foreground">{t({ ko: '평가 이유 보기', en: 'See feedback reasons' })}</summary><div className="mt-2">{stats.reasons.map((item) => <div key={item.eventId} className="space-y-1 border-b border-line py-3 last:border-0"><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={item.current ? 'ghost' : 'secondary'}>{item.current ? t({ ko: '현재 판', en: 'Current version' }) : t({ ko: '이전 판', en: 'Earlier version' })} {item.contentVersion}</Badge><span>{item.evaluator === 'human' ? t({ ko: '사람', en: 'Person' }) : item.evaluator === 'judge' ? t({ ko: '판단모델', en: 'Judge' }) : t({ ko: '사용 AI', en: 'AI user' })}</span><span>{formatDateTime(item.createdAt)}</span></div>{item.reason ? <p className="whitespace-pre-wrap text-sm">{item.reason}</p> : item.reasonCode ? <p className="text-sm">{t(reasons.find((entry) => entry.value === item.reasonCode) ?? { ko: '평가 의견', en: 'Feedback' })}</p> : null}{item.evidenceQuote ? <blockquote className="whitespace-pre-wrap border-l-2 border-line pl-3 text-sm text-muted-foreground">{item.evidenceQuote}</blockquote> : null}</div>)}</div></details> : null}
          </> : null}
          <PostKnowledgeAssessmentAudit post={post} />
        </Section>
        <PostKnowledgeTaskFit key={searchContext?.receipt.token ?? 'direct'} post={post} context={searchContext} />
        <Section heading={t({ ko: '검토', en: 'Review' })} actions={<>
          {post.knowledge?.canReview ? <Button variant="secondary" size="sm" onClick={() => setReview({ action: 'verify' })}>{t({ ko: '현재 판 검증', en: 'Verify current version' })}</Button> : null}
          {post.knowledge?.canEvaluate ? <><Button variant="ghost" size="sm" onClick={() => setReview({ action: 'request_review' })}>{t({ ko: '재검토 요청', en: 'Request review' })}</Button><Button variant="ghost" size="sm" onClick={() => setReview({ action: 'report_error' })}>{t({ ko: '오류 제보', en: 'Report error' })}</Button></> : null}
        </>}>
          {issues.map((issue) => (
            <div key={issue.id} className="flex items-start gap-3 border-b border-line py-3 last:border-0">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2"><p className="whitespace-pre-wrap text-sm">{issue.reason}</p>{issue.resolvedAt ? <Badge variant="success">{t({ ko: '해결됨', en: 'Resolved' })}</Badge> : <Badge variant="warning">{t({ ko: '열린 문제', en: 'Open issue' })}</Badge>}</div>
                <p className="text-xs text-muted-foreground">{t({ ko: '내용 {version}판에서 제보', en: 'Reported on content version {version}' }, { version: issue.contentVersion })}</p>
                {issue.evidenceQuote ? <blockquote className="whitespace-pre-wrap border-l-2 border-line pl-3 text-sm text-muted-foreground">{issue.evidenceQuote}</blockquote> : null}
                {issue.resolution ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{t({ ko: '해결 근거: {reason}', en: 'Resolution: {reason}' }, { reason: issue.resolution })}</p> : null}
              </div>
              {post.knowledge?.canReview && !issue.resolvedAt ? <Button variant="ghost" size="sm" onClick={() => setReview({ action: 'resolve_issue', issue })}>{t({ ko: '해결 확인', en: 'Resolve' })}</Button> : null}
            </div>
          ))}
          <PostKnowledgeEvaluations post={post} />
        </Section>
        <Section heading={t({ ko: '출처와 문서 연결', en: 'Sources and document links' })} actions={<>
          {post.canEdit ? <Button variant="ghost" size="sm" onClick={() => setMetadataOpen(true)}><Pencil />{t({ ko: '출처 고치기', en: 'Edit sources' })}</Button> : null}
          <Button variant="ghost" size="sm" disabled={download.isPending} onClick={() => download.mutate()}><Download />{t({ ko: '내보내기', en: 'Export' })}</Button>
        </>}>
          {links.isPending ? <LoadingState /> : links.isError ? <ErrorState size="compact" error={links.error} onRetry={() => void links.refetch()} /> : links.data ? <>
            <KnowledgeSources sources={links.data.sources} />
            {links.data.links.length ? <div className="flex flex-wrap gap-3">{links.data.links.map((link, index) => link.postId ? <Link key={index} to={postRoute({ postId: link.postId, commentId: link.commentId })} className="inline-flex items-center gap-1 text-sm text-secondary-text hover:underline"><LinkIcon className="size-3.5" />{link.title}</Link> : <span key={index} className="text-sm text-muted-foreground">{t({ ko: '미연결: {title}', en: 'Unresolved: {title}' }, { title: link.title })}</span>)}</div> : null}
            {links.data.backlinks.length ? <div><h3 className="mb-2 text-sm font-medium">{t({ ko: '이 문서를 참조하는 글', en: 'Posts referring to this document' })}</h3><div className="flex flex-wrap gap-3">{links.data.backlinks.map((link) => <Link key={link.postId} to={postRoute({ postId: link.postId, commentId: null })} className="text-sm text-secondary-text hover:underline">{link.title}</Link>)}</div></div> : null}
            {links.data.aliases.length ? <p className="text-xs text-muted-foreground">{t({ ko: '다른 이름: {aliases}', en: 'Aliases: {aliases}' }, { aliases: links.data.aliases.join(' · ') })}</p> : null}
            {post.knowledge?.replacementPostId ? <Link to={postRoute({ postId: post.knowledge.replacementPostId, commentId: null })} className="text-sm text-secondary-text hover:underline">{t({ ko: '대체 문서 #{id}', en: 'Replacement document #{id}' }, { id: post.knowledge.replacementPostId })}</Link> : null}
          </> : null}
        </Section>
        <PostKnowledgeProposals postId={post.id} />
      </> : null}
      </> : null}
      </div>
      {metadataOpen ? <KnowledgeMetadataEditor key={post.revision} post={post} onClose={() => setMetadataOpen(false)} /> : null}
      {vote ? <KnowledgeVoteDialog post={post} quality={vote} onClose={() => setVote(null)} /> : null}
      {review ? <KnowledgeReviewDialog post={post} {...review} onClose={() => setReview(null)} /> : null}
      {proposalMode ? <KnowledgeProposalEditor post={post} mode={proposalMode} onClose={() => setProposalMode(null)} /> : null}
    </footer>
  )
}
