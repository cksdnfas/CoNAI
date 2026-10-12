import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostAssessmentQuality, PostDetail, PostReviewIssue } from '@conai/shared'
import { BookOpen, BookX, Check, Download, FilePlus2, Flag, Link as LinkIcon, MoreHorizontal, Pencil, RefreshCw, RotateCcw, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, cancelPostVote, exportPostKnowledge, getPostQuality, getPostsSettings, reviewPost, updatePostKnowledge, votePost } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { KnowledgeSourcesEditor } from './post-knowledge-sources'
import { KnowledgeProposalEditor } from './post-knowledge-proposals'
import type { PostTopicEvaluationState } from './post-topic-relevance'
import { usePostPermissions } from './use-post-permissions'

export const KNOWLEDGE_REASONS = [
  { value: 'error', ko: '오류', en: 'Error' },
  { value: 'outdated', ko: '오래된 정보', en: 'Outdated' },
  { value: 'insufficient_evidence', ko: '근거 부족', en: 'Missing evidence' },
  { value: 'reproduction_failed', ko: '재현 실패', en: 'Could not reproduce' },
  { value: 'helpful', ko: '해결에 기여', en: 'Helped' },
  { value: 'scope_mismatch', ko: '작업에 안 맞음', en: 'Did not fit the task' },
] as const
const DOWN_REASONS = KNOWLEDGE_REASONS.filter((item) => item.value !== 'helpful' && item.value !== 'scope_mismatch')

export type KnowledgeReviewAction = 'verify' | 'request_review' | 'report_error' | 'resolve_issue'

/** Whether the board's knowledge feature is on and this post takes part in it (designated, not in the trash). */
export function usePostKnowledgeState(post: PostDetail) {
  const settings = useQuery({ queryKey: ['post-settings'], queryFn: getPostsSettings, staleTime: 60_000 })
  const featureEnabled = settings.data?.knowledge.enabled !== false
  const enabled = post.knowledge?.enabled === true
  return { featureEnabled, enabled, active: enabled && !post.knowledge?.deletedAt && featureEnabled }
}

/** Quality stats of the current version; the vote row and the 평가 tab share the query. */
export function usePostQuality(post: PostDetail, enabled: boolean) {
  const permissions = usePostPermissions()
  return useQuery({ queryKey: [POSTS_QUERY_KEY, 'quality', permissions.viewerKey, post.id, post.knowledge?.contentVersion], queryFn: () => getPostQuality(post.id), enabled })
}

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

export function KnowledgeReviewDialog({ post, action, issue, onClose }: { post: PostDetail; action: KnowledgeReviewAction; issue?: PostReviewIssue; onClose: () => void }) {
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
        {issue ? <p className="whitespace-pre-wrap text-sm">{issue.reason}</p> : null}
        <Field label={action === 'resolve_issue' ? t({ ko: '해결 근거', en: 'Resolution evidence' }) : t({ ko: '이유', en: 'Reason' })}><Textarea rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <Field label={t({ ko: '본문 인용 (선택)', en: 'Quote (optional)' })}><Textarea rows={2} maxLength={2000} value={quote} onChange={(event) => setQuote(event.target.value)} /></Field>
      </ModalBody>
      <ModalFooter><Button variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button><Button disabled={!reason.trim() || save.isPending} onClick={() => save.mutate()}>{title}</Button></ModalFooter>
    </Modal>
  )
}

/** Rounded for the pill; fractional weights keep one decimal only when rounding would hide them entirely. */
function voteCount(value: number) {
  const rounded = Math.round(value)
  return rounded === 0 && value > 0 ? Number(value.toFixed(1)) : rounded
}

const PILL = 'h-9 gap-2 rounded-full px-4 text-sm tabular-nums'

/** 👍 / 👎 at the end of the body, and the ⋯ menu with every document action. */
export function PostVoteBar({ post, topic }: { post: PostDetail; topic: PostTopicEvaluationState }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = usePostPermissions()
  const { featureEnabled, enabled, active } = usePostKnowledgeState(post)
  const quality = usePostQuality(post, active)
  const [downOpen, setDownOpen] = useState(false)
  const [reasonCode, setReasonCode] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [review, setReview] = useState<KnowledgeReviewAction | null>(null)
  const [proposalMode, setProposalMode] = useState<'create' | 'update' | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
  const vote = useMutation({
    mutationFn: (input: { quality: PostAssessmentQuality; reasonCode?: string; reason?: string }) => votePost(post.id, {
      contentVersion: post.knowledge!.contentVersion, idempotencyKey: crypto.randomUUID(), quality: input.quality,
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}), reason: input.reason ?? '', evidenceQuote: '',
    }),
    onSuccess: async () => { setDownOpen(false); setReasonCode(null); setReason(''); await refresh() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가를 저장하지 못했어.', en: 'Could not save the vote.' })) }),
  })
  const cancelVote = useMutation({
    mutationFn: () => cancelPostVote(post.id, post.knowledge!.contentVersion, crypto.randomUUID()),
    onSuccess: refresh,
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가를 취소하지 못했어.', en: 'Could not cancel the vote.' })) }),
  })
  const change = useMutation({
    mutationFn: (nextEnabled: boolean) => updatePostKnowledge(post.id, { expectedRevision: post.revision, enabled: nextEnabled }),
    onSuccess: refresh,
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '지식 지정을 바꾸지 못했어.', en: 'Could not change knowledge status.' })) }),
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
  if (post.knowledge?.deletedAt) return null

  const knowledge = post.knowledge
  const proposalItems = featureEnabled && permissions.canWrite ? [
    ...(enabled ? [<DropdownMenuItem key="update" onSelect={() => setProposalMode('update')}><Pencil />{t({ ko: '수정 제안', en: 'Suggest a change' })}</DropdownMenuItem>] : []),
    <DropdownMenuItem key="create" onSelect={() => setProposalMode('create')}><FilePlus2 />{t({ ko: '이 글로 문서 초안', en: 'Draft a document from this post' })}</DropdownMenuItem>,
  ] : []
  const reviewItems = [
    ...(active && knowledge?.canReview ? [<DropdownMenuItem key="verify" onSelect={() => setReview('verify')}><ShieldCheck />{t({ ko: '현재 판 검증', en: 'Verify current version' })}</DropdownMenuItem>] : []),
    ...(active && knowledge?.canEvaluate ? [
      <DropdownMenuItem key="request" onSelect={() => setReview('request_review')}><RotateCcw />{t({ ko: '재검토 요청', en: 'Request review' })}</DropdownMenuItem>,
      <DropdownMenuItem key="report" onSelect={() => setReview('report_error')}><Flag />{t({ ko: '오류 제보', en: 'Report an error' })}</DropdownMenuItem>,
    ] : []),
    ...(topic.value?.canRequest ? [<DropdownMenuItem key="topic" disabled={!topic.canRequest} onSelect={topic.request}>{topic.value.evaluatedAt ? <RefreshCw /> : <Sparkles />}{topic.waiting ? t({ ko: '주제 관련도 평가 중', en: 'Evaluating topics' }) : topic.value.evaluatedAt ? t({ ko: '주제 관련도 다시 평가', en: 'Re-evaluate topics' }) : t({ ko: '주제 관련도 평가 요청', en: 'Evaluate topics' })}</DropdownMenuItem>] : []),
  ]
  const documentItems = active ? [
    ...(post.canEdit ? [<DropdownMenuItem key="sources" onSelect={() => setMetadataOpen(true)}><LinkIcon />{t({ ko: '출처 고치기', en: 'Edit sources' })}</DropdownMenuItem>] : []),
    <DropdownMenuItem key="export" disabled={download.isPending} onSelect={() => download.mutate()}><Download />{t({ ko: '내보내기', en: 'Export' })}</DropdownMenuItem>,
  ] : []
  const designateItems = featureEnabled && post.canEdit ? [
    <DropdownMenuItem key="designate" variant={enabled ? 'destructive' : 'default'} disabled={change.isPending} onSelect={async () => {
      if (!enabled || await confirm({ title: t({ ko: '지식 문서 지정을 해제할까?', en: 'Remove knowledge designation?' }), description: t({ ko: '저장한 판과 평가 이력은 남아.', en: 'Saved versions and feedback remain.' }) })) change.mutate(!enabled)
    }}>{enabled ? <BookX /> : <BookOpen />}{enabled ? t({ ko: '지식 지정 해제', en: 'Remove designation' }) : t({ ko: '지식으로 지정', en: 'Designate as knowledge' })}</DropdownMenuItem>,
  ] : []
  const groups = [proposalItems, reviewItems, documentItems, designateItems].filter((group) => group.length)

  const stats = quality.data
  const own = stats?.ownVote?.quality
  const canVote = knowledge?.canEvaluate === true && Boolean(stats) && !vote.isPending && !cancelVote.isPending
  const noPermission = knowledge?.canEvaluate ? null : t({ ko: '평가 권한이 없어', en: 'No permission to vote' })
  const pressUp = () => own === 'up' ? cancelVote.mutate() : vote.mutate({ quality: 'up' })
  const pressDown = () => { if (own === 'down') cancelVote.mutate(); else setDownOpen(true) }

  if (!active && !groups.length) return null
  return (
    <div className="relative flex min-h-9 items-center justify-center gap-2 py-6" aria-label={t({ ko: '게시물 평가', en: 'Post feedback' })}>
      {active ? quality.isError ? (
        <Button variant="ghost" size="sm" onClick={() => void quality.refetch()}><RefreshCw />{t({ ko: '평가 다시 불러오기', en: 'Retry feedback' })}</Button>
      ) : <>
        <Tip content={noPermission}>
          <span className="inline-flex">
            <Button variant="ghost" disabled={!canVote} aria-pressed={own === 'up'} onClick={pressUp}
              aria-label={t({ ko: '추천 {score}', en: 'Recommend, {score}' }, { score: stats ? Number(stats.up.toFixed(2)) : 0 })}
              className={cn(PILL, own === 'up' ? 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary' : 'bg-surface-low')}>
              <ThumbsUp />{stats ? voteCount(stats.up) : null}
            </Button>
          </span>
        </Tip>
        <Popover open={downOpen} onOpenChange={setDownOpen}>
          <Tip content={noPermission}>
            <span className="inline-flex">
              <PopoverAnchor asChild>
                <Button variant="ghost" disabled={!canVote} aria-pressed={own === 'down'} aria-haspopup="dialog" onClick={pressDown}
                  aria-label={t({ ko: '비추천 {score}', en: 'Do not recommend, {score}' }, { score: stats ? Number(stats.down.toFixed(2)) : 0 })}
                  className={cn(PILL, own === 'down' ? 'bg-info-soft text-info-soft-foreground hover:bg-info-soft hover:text-info-soft-foreground' : 'bg-surface-low')}>
                  <ThumbsDown />{stats ? voteCount(stats.down) : null}
                </Button>
              </PopoverAnchor>
            </span>
          </Tip>
          <PopoverContent align="center" className="w-80 space-y-3 p-3" aria-label={t({ ko: '비추천 이유', en: 'Reason for not recommending' })}>
            <div className="flex flex-wrap gap-1.5">
              {DOWN_REASONS.map((item) => (
                <Button key={item.value} variant="ghost" size="xs" aria-pressed={reasonCode === item.value} onClick={() => setReasonCode(reasonCode === item.value ? null : item.value)}
                  className={cn('h-7 rounded-full px-3', reasonCode === item.value ? 'bg-info-soft text-info-soft-foreground hover:bg-info-soft hover:text-info-soft-foreground' : 'bg-surface-container')}>
                  {t(item)}
                </Button>
              ))}
            </div>
            <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); if (!vote.isPending) vote.mutate({ quality: 'down', reasonCode: reasonCode ?? undefined, reason: reason.trim() }) }}>
              <Input autoFocus value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} placeholder={t({ ko: '한 줄 이유', en: 'One-line reason' })} aria-label={t({ ko: '한 줄 이유', en: 'One-line reason' })} className="flex-1" />
              <IconButton type="submit" size="icon-sm" disabled={vote.isPending} label={t({ ko: '비추천 남기기', en: 'Save' })}><Check /></IconButton>
            </form>
          </PopoverContent>
        </Popover>
      </> : null}
      {groups.length ? (
        <div className="absolute right-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton variant="ghost" size="icon-sm" label={t({ ko: '더 보기', en: 'More' })}><MoreHorizontal /></IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {groups.map((group, index) => <span key={index} className="contents">{index > 0 ? <DropdownMenuSeparator /> : null}{group}</span>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      {metadataOpen ? <KnowledgeMetadataEditor key={post.revision} post={post} onClose={() => setMetadataOpen(false)} /> : null}
      {review ? <KnowledgeReviewDialog post={post} action={review} onClose={() => setReview(null)} /> : null}
      {proposalMode ? <KnowledgeProposalEditor post={post} mode={proposalMode} onClose={() => setProposalMode(null)} /> : null}
    </div>
  )
}
