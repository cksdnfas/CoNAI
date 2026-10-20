import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostAssessmentQuality, PostDetail, PostReviewIssue } from '@conai/shared'
import { Check, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleChip } from '@/components/ui/chip'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, invalidatePostScope, cancelPostVote, getPostQuality, getPostsSettings, reviewPost, updatePostKnowledge, votePost } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { KnowledgeSourcesEditor } from './post-knowledge-sources'
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

export function KnowledgeMetadataEditor({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [sources, setSources] = useState(post.knowledgeSources ?? [])
  const save = useMutation({
    mutationFn: () => updatePostKnowledge(post.id, { expectedRevision: post.revision, sources }),
    onSuccess: async () => { await invalidatePostScope(queryClient, post.id, 'post'); onClose() },
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
    onSuccess: async () => { await invalidatePostScope(queryClient, post.id, 'post'); onClose() },
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

/** 👍 / 👎 at the end of a knowledge document's body; every other document action is in the post's ⋯ menu. */
export function PostVoteBar({ post }: { post: PostDetail }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const { active } = usePostKnowledgeState(post)
  const quality = usePostQuality(post, active)
  const [downOpen, setDownOpen] = useState(false)
  const [reasonCode, setReasonCode] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const refresh = () => invalidatePostScope(queryClient, post.id, 'post')
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
  if (!active) return null

  const knowledge = post.knowledge
  const stats = quality.data
  const own = stats?.ownVote?.quality
  const canVote = knowledge?.canEvaluate === true && Boolean(stats) && !vote.isPending && !cancelVote.isPending
  const noPermission = knowledge?.canEvaluate ? null : t({ ko: '평가 권한이 없어', en: 'No permission to vote' })
  const pressUp = () => own === 'up' ? cancelVote.mutate() : vote.mutate({ quality: 'up' })
  const pressDown = () => { if (own === 'down') cancelVote.mutate(); else setDownOpen(true) }

  return (
    <div className="flex min-h-9 items-center justify-center gap-2 py-6" aria-label={t({ ko: '게시물 평가', en: 'Post feedback' })}>
      {quality.isError ? (
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
                <ToggleChip key={item.value} pressed={reasonCode === item.value} onClick={() => setReasonCode(reasonCode === item.value ? null : item.value)}>
                  {t(item)}
                </ToggleChip>
              ))}
            </div>
            <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); if (!vote.isPending) vote.mutate({ quality: 'down', reasonCode: reasonCode ?? undefined, reason: reason.trim() }) }}>
              <Input autoFocus value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} placeholder={t({ ko: '한 줄 이유', en: 'One-line reason' })} aria-label={t({ ko: '한 줄 이유', en: 'One-line reason' })} className="flex-1" />
              <IconButton type="submit" size="icon-sm" disabled={vote.isPending} label={t({ ko: '비추천 남기기', en: 'Save' })}><Check /></IconButton>
            </form>
          </PopoverContent>
        </Popover>
      </>}
    </div>
  )
}
