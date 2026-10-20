import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostAssessmentTaskFit, PostDetail, PostSummary } from '@conai/shared'
import { Search, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, invalidatePostScope, getPostTaskFit, setPostTaskFit } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { usePostPermissions } from './use-post-permissions'

/** Kept in browser navigation state, never in a shareable post URL or connected chat data. */
export type KnowledgeSearchContext = {
  viewerKey: string
  postId: number
  contentVersion: number
  contentHash: string
  receipt: NonNullable<PostSummary['knowledgeSearchReceipt']>
}

export function parseKnowledgeSearchContext(value: unknown): KnowledgeSearchContext | null {
  if (!value || typeof value !== 'object') return null
  const context = value as Partial<KnowledgeSearchContext>
  return typeof context.viewerKey === 'string' && typeof context.postId === 'number' && typeof context.contentVersion === 'number'
    && typeof context.contentHash === 'string' && context.receipt && typeof context.receipt.token === 'string'
    && typeof context.receipt.query === 'string' && typeof context.receipt.expiresAt === 'string' ? context as KnowledgeSearchContext : null
}

function TaskFitDialog({ post, context, taskFit, onClose }: { post: PostDetail; context: KnowledgeSearchContext; taskFit: 'useful' | 'unsuitable'; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: (idempotencyKey: string) => setPostTaskFit(post.id, { contentVersion: context.contentVersion, searchReceiptToken: context.receipt.token, taskFit, idempotencyKey, reasonCode: taskFit === 'unsuitable' ? 'scope_mismatch' : 'helpful', reason }),
    onSuccess: async () => { await invalidatePostScope(queryClient, post.id, 'post'); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '검색 의견을 저장하지 못했어.', en: 'Could not save search feedback.' })) }),
  })
  return <Modal open onClose={onClose} title={taskFit === 'useful' ? t({ ko: '이 검색에 유용했어', en: 'Useful for this search' }) : t({ ko: '이 검색엔 맞지 않아', en: 'Unsuitable for this search' })} size="narrow">
    <ModalBody>
      <p className="whitespace-pre-wrap text-sm">{t({ ko: '검색: {query}', en: 'Search: {query}' }, { query: context.receipt.query })}</p>
      <Field label={t({ ko: '설명 (선택)', en: 'Explanation (optional)' })}><Textarea rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
    </ModalBody>
    <ModalFooter><Button variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button><Button disabled={save.isPending} onClick={() => save.mutate(crypto.randomUUID())}>{t({ ko: '검색 의견 저장', en: 'Save search feedback' })}</Button></ModalFooter>
  </Modal>
}

export function PostKnowledgeTaskFit({ post, context }: { post: PostDetail; context: KnowledgeSearchContext | null }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = usePostPermissions()
  const ownContext = context?.viewerKey === permissions.viewerKey && context.postId === post.id ? context : null
  const isCurrent = ownContext !== null && ownContext.contentHash === post.knowledge?.contentHash && ownContext.contentVersion === post.knowledge.contentVersion
  const expired = ownContext !== null && Date.parse(ownContext.receipt.expiresAt) <= Date.now()
  const allowed = isCurrent && !expired && post.knowledge?.canEvaluate === true
  const query = useQuery({ queryKey: [POSTS_QUERY_KEY, 'task-fit', permissions.viewerKey, post.id, ownContext?.receipt.token], queryFn: () => getPostTaskFit(post.id, ownContext!.receipt.token), enabled: allowed })
  const [picked, setPicked] = useState<'useful' | 'unsuitable' | null>(null)
  const cancel = useMutation({
    mutationFn: (idempotencyKey: string) => setPostTaskFit(post.id, { contentVersion: ownContext!.contentVersion, searchReceiptToken: ownContext!.receipt.token, taskFit: 'unknown', idempotencyKey }),
    onSuccess: () => invalidatePostScope(queryClient, post.id, 'post'),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '검색 의견을 취소하지 못했어.', en: 'Could not cancel search feedback.' })) }),
  })
  if (!ownContext) return null
  const taskFit: PostAssessmentTaskFit = query.data?.taskFit ?? 'unknown'
  return <div className="flex flex-wrap items-center gap-2 border-b border-line py-2.5 text-sm" aria-label={t({ ko: '이 검색의 적합성', en: 'Fit for this search' })}>
    <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    <span className="min-w-0 flex-1 truncate text-muted-foreground" title={ownContext.receipt.query}>{ownContext.receipt.query}</span>
    {allowed ? <>
      <Button variant={taskFit === 'useful' ? 'secondary' : 'ghost'} size="xs" aria-pressed={taskFit === 'useful'} onClick={() => setPicked('useful')}>{t({ ko: '유용했어', en: 'Useful' })}</Button>
      <Button variant={taskFit === 'unsuitable' ? 'secondary' : 'ghost'} size="xs" aria-pressed={taskFit === 'unsuitable'} onClick={() => setPicked('unsuitable')}>{t({ ko: '맞지 않아', en: 'Unsuitable' })}</Button>
      {taskFit !== 'unknown' ? <IconButton variant="ghost" size="icon-xs" disabled={cancel.isPending} label={t({ ko: '검색 의견 취소', en: 'Cancel search feedback' })} onClick={() => cancel.mutate(crypto.randomUUID())}><Undo2 /></IconButton> : null}
    </> : <span className="text-xs text-muted-foreground">{t({ ko: '검색 기록 만료', en: 'Search record expired' })}</span>}
    {query.isError ? <ErrorState size="compact" error={query.error} onRetry={() => void query.refetch()} /> : null}
    {query.data?.reason ? <p className="w-full whitespace-pre-wrap text-xs text-muted-foreground">{query.data.reason}</p> : null}
    {picked && allowed && ownContext ? <TaskFitDialog post={post} context={ownContext} taskFit={picked} onClose={() => setPicked(null)} /> : null}
  </div>
}
