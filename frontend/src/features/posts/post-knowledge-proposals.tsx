import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostDetail, PostKnowledgeSource } from '@conai/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ErrorState } from '@/components/ui/error-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { TextDiff } from '@/components/common/text-diff'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, invalidatePostScope, applyPostKnowledgeProposal, createPostKnowledgeProposal, getPost, getPostKnowledgeProposal, listPostKnowledgeProposals, listPosts, rejectPostKnowledgeProposal } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { KnowledgeSources, KnowledgeSourcesEditor, knowledgeSource } from './post-knowledge-sources'
import { postRoute } from './post-links'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { usePostComments } from './use-post-comments'

/** The proposed Markdown and citations stay pending until a person applies them. */
export function KnowledgeProposalEditor({ post, mode, onClose }: { post: PostDetail; mode: 'create' | 'update'; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(mode === 'update' ? post.title : t({ ko: '{title} 정리', en: '{title} notes' }, { title: post.title }))
  const [body, setBody] = useState(post.body)
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [sources, setSources] = useState<PostKnowledgeSource[]>(mode === 'update' ? post.knowledgeSources ?? [] : [{ ...knowledgeSource(), postId: post.id, revision: post.revision, contentVersion: post.knowledge?.contentVersion ?? null, contentHash: post.knowledge?.contentHash ?? null }])
  const [selectedComments, setSelectedComments] = useState<number[]>([])
  const searchTitle = useDebouncedValue(title.trim())
  const comments = usePostComments(post.id, [], mode === 'create')
  const similar = useQuery({ queryKey: [POSTS_QUERY_KEY, 'proposal-similar', searchTitle], queryFn: () => listPosts({ kind: 'knowledge', q: searchTitle, limit: 5, sort: 'relevance' }), enabled: searchTitle.length > 0 })
  const save = useMutation({
    mutationFn: (idempotencyKey: string) => createPostKnowledgeProposal({
      kind: mode, title, body, reason, idempotencyKey,
      ...(mode === 'update' ? { postId: post.id, baseRevision: post.revision, baseContentVersion: post.knowledge!.contentVersion } : { categoryId: post.categoryId, tags: post.tags, status }),
      sources: [...sources, ...selectedComments.map((commentId) => ({ ...knowledgeSource('comment'), postId: post.id, commentId }))],
    }),
    onSuccess: async (saved) => { await invalidatePostScope(queryClient, saved.postId, 'proposal'); showSnackbar({ tone: 'info', message: t({ ko: '검토할 제안을 저장했어.', en: 'Saved the proposal for review.' }) }); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '제안을 저장하지 못했어.', en: 'Could not save the proposal.' })) }),
  })
  return (
    <Modal open onClose={onClose} title={mode === 'update' ? t({ ko: '지식 문서 수정 제안', en: 'Propose a knowledge change' }) : t({ ko: '글·댓글로 지식 초안', en: 'Draft knowledge from a post and comments' })} size="wide" height="tall" dirty onSave={() => { if (title.trim() && !save.isPending) save.mutate(crypto.randomUUID()) }}>
      <ModalBody>
        <Field label={t({ ko: '제목', en: 'Title' })}><Input maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        {similar.data?.items.some((item) => item.id !== post.id) ? <Section heading={t({ ko: '기존 문서 확인', en: 'Check existing documents' })}><div className="flex flex-wrap gap-3">{similar.data.items.filter((item) => item.id !== post.id).map((item) => <Link key={item.id} to={postRoute({ postId: item.id, commentId: null })} target="_blank" className="text-sm text-secondary-text hover:underline">{item.title}</Link>)}</div></Section> : null}
        <Field label={t({ ko: '제안 본문 (Markdown)', en: 'Proposed text (Markdown)' })}><Textarea rows={16} maxLength={200000} className="font-mono" value={body} onChange={(event) => setBody(event.target.value)} /></Field>
        {mode === 'create' && comments.comments.some((comment) => comment.status === 'visible') ? <Section heading={t({ ko: '참고할 댓글', en: 'Comments to cite' })} bodyClassName="space-y-0"><div>{comments.comments.filter((comment) => comment.status === 'visible').map((comment) => <label key={comment.id} className="flex cursor-pointer items-start gap-3 border-b border-line py-3 last:border-0"><Checkbox checked={selectedComments.includes(comment.id)} onCheckedChange={(checked) => setSelectedComments((current) => checked ? [...current, comment.id] : current.filter((id) => id !== comment.id))} /><span className="min-w-0 flex-1"><span className="text-xs text-muted-foreground">#{comment.id} · {comment.author.name}</span><span className="mt-1 block line-clamp-3 whitespace-pre-wrap text-sm">{comment.body}</span></span></label>)}</div>
          {comments.hasMore ? <Button variant="ghost" disabled={comments.isLoadingMore} onClick={() => void comments.loadMore().catch(() => undefined)}>{t({ ko: '이전 댓글 더 보기', en: 'Load earlier comments' })}</Button> : null}
          {[...comments.moreReplies].filter(([, cursor]) => cursor).map(([parentId]) => <Button key={parentId} variant="ghost" disabled={comments.loadingReplies.has(parentId)} onClick={() => void comments.loadMoreReplies(parentId).catch(() => undefined)}>{t({ ko: '#{id} 이전 답글 더 보기', en: 'Load earlier replies to #{id}' }, { id: parentId })}</Button>)}
        </Section> : null}
        {mode === 'create' && comments.error ? <ErrorState size="compact" error={comments.error} onRetry={() => void comments.retry()} /> : null}
        <Section heading={t({ ko: '반영할 출처', en: 'Sources to apply' })}><KnowledgeSourcesEditor sources={sources} onChange={setSources} /></Section>
        <Field label={t({ ko: '제안 이유', en: 'Proposal reason' })}><Textarea rows={2} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        {mode === 'create' ? <Field label={t({ ko: '승인 후 상태', en: 'Status after approval' })}><Select value={status} onChange={(event) => setStatus(event.target.value as 'draft' | 'published')}><option value="draft">{t({ ko: '초안', en: 'Draft' })}</option><option value="published">{t({ ko: '발행', en: 'Published' })}</option></Select></Field> : null}
      </ModalBody>
      <ModalFooter><Button variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button><Button disabled={!title.trim() || save.isPending} onClick={() => save.mutate(crypto.randomUUID())}>{t({ ko: '검토할 제안 저장', en: 'Save proposal for review' })}</Button></ModalFooter>
    </Modal>
  )
}

export function KnowledgeProposalReview({ proposalId, onClose }: { proposalId: string; onClose: () => void }) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const proposal = useQuery({ queryKey: [POSTS_QUERY_KEY, 'proposal', proposalId], queryFn: () => getPostKnowledgeProposal(proposalId) })
  const current = useQuery({ queryKey: [POSTS_QUERY_KEY, 'post', proposal.data?.postId], queryFn: () => getPost(proposal.data!.postId!), enabled: proposal.data?.kind === 'update' && proposal.data.postId !== null })
  const [rejectReason, setRejectReason] = useState('')
  const apply = useMutation({
    mutationFn: () => applyPostKnowledgeProposal(proposalId, proposal.data!.kind === 'update' ? { expectedRevision: proposal.data!.baseRevision!, contentVersion: proposal.data!.baseContentVersion! } : {}),
    onSuccess: async (saved) => { queryClient.setQueryData([POSTS_QUERY_KEY, 'proposal', saved.id], saved); await invalidatePostScope(queryClient, saved.appliedPostId ?? saved.postId, 'post'); showSnackbar({ tone: 'info', message: t({ ko: '제안을 반영했어.', en: 'Applied the proposal.' }) }); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '제안을 반영하지 못했어. 현재 판을 확인해줘.', en: 'Could not apply the proposal. Check the current version.' })) }),
  })
  const reject = useMutation({
    mutationFn: () => rejectPostKnowledgeProposal(proposalId, rejectReason),
    onSuccess: async (saved) => { queryClient.setQueryData([POSTS_QUERY_KEY, 'proposal', saved.id], saved); await invalidatePostScope(queryClient, saved.postId, 'proposal'); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '제안을 거절하지 못했어.', en: 'Could not reject the proposal.' })) }),
  })
  const data = proposal.data
  const conflict = data?.kind === 'update' && current.data && (current.data.revision !== data.baseRevision || current.data.knowledge?.contentVersion !== data.baseContentVersion)
  const ready = data?.kind === 'create' || current.isSuccess
  return (
    <Modal open onClose={onClose} title={t({ ko: '지식 문서 변경 검토', en: 'Review knowledge changes' })} size="wide" height="tall">
      <ModalBody>
        {proposal.isPending ? <LoadingState /> : proposal.isError ? <ErrorState error={proposal.error} onRetry={() => void proposal.refetch()} /> : data ? <>
          <div className="flex flex-wrap items-center gap-2"><Badge variant={data.status === 'pending' ? 'warning' : data.status === 'applied' ? 'success' : 'secondary'}>{data.status === 'pending' ? t({ ko: '검토 대기', en: 'Pending review' }) : data.status === 'applied' ? t({ ko: '반영됨', en: 'Applied' }) : t({ ko: '거절됨', en: 'Rejected' })}</Badge><span className="text-xs text-muted-foreground">{data.proposedByName} · {formatDateTime(data.createdAt)}</span></div>
          <p className="text-sm">{t({ ko: '반영 후 상태: {status}', en: 'Status after applying: {status}' }, { status: data.proposedPostStatus === 'published' ? t({ ko: '발행 · 열람 권한이 있는 사람에게 공개', en: 'Published · visible to people with access' }) : data.proposedPostStatus === 'hidden' ? t({ ko: '숨김', en: 'Hidden' }) : t({ ko: '초안', en: 'Draft' }) })}</p>
          {data.tags.length ? <p className="text-xs text-muted-foreground">{data.tags.map((tag) => `#${tag}`).join(' · ')}</p> : null}
          {data.reason ? <p className="whitespace-pre-wrap text-sm">{data.reason}</p> : null}
          {conflict ? <ErrorState size="compact" title={t({ ko: '제안 이후 문서가 바뀌었어', en: 'The document changed after this proposal' })} description={t({ ko: '현재 판을 기준으로 새 제안을 만들어줘.', en: 'Create a new proposal based on the current version.' })} /> : null}
          {current.isError ? <ErrorState size="compact" error={current.error} onRetry={() => void current.refetch()} /> : null}
          <Section heading={t({ ko: '제목 차이', en: 'Title changes' })}><TextDiff className="max-h-96" before={data.baseTitle ?? ''} after={data.title} /></Section>
          <Section heading={t({ ko: '본문 차이', en: 'Text changes' })}><TextDiff className="max-h-96" before={data.baseBody ?? ''} after={data.body} /></Section>
          {data.kind === 'update' ? <Section heading={t({ ko: '기존 출처', en: 'Previous sources' })}><KnowledgeSources sources={data.baseSources} /></Section> : null}
          <Section heading={t({ ko: '반영할 출처와 공개 인용', en: 'Sources and public quotations to apply' })}><KnowledgeSources sources={data.sources} /></Section>
          {data.attachments.length ? <Section heading={t({ ko: '본문에 연결할 첨부', en: 'Attachments linked from the text' })}><div>{data.attachments.map((attachment, index) => <p key={index} className="break-all border-b border-line py-2 text-xs text-muted-foreground last:border-0">{attachment.kind === 'file' ? t({ ko: '파일', en: 'File' }) : attachment.kind === 'audio' ? t({ ko: '오디오', en: 'Audio' }) : attachment.kind === 'group' ? t({ ko: '이미지 그룹', en: 'Image group' }) : t({ ko: '이미지·영상', en: 'Image or video' })} · {attachment.ref}</p>)}</div></Section> : null}
          {data.reviewReason ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{data.reviewReason}</p> : null}
          {data.appliedPostId ? <Link className="text-sm text-secondary-text hover:underline" to={postRoute({ postId: data.appliedPostId, commentId: null })} onClick={onClose}>{t({ ko: '반영된 문서 열기', en: 'Open applied document' })}</Link> : null}
          {data.status === 'pending' && data.canReject ? <Field label={t({ ko: '거절 이유', en: 'Rejection reason' })}><Textarea rows={2} value={rejectReason} maxLength={2000} onChange={(event) => setRejectReason(event.target.value)} /></Field> : null}
        </> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{t({ ko: '닫기', en: 'Close' })}</Button>
        {data?.status === 'pending' && data.canReject ? <Button variant="destructive" disabled={!rejectReason.trim() || reject.isPending || apply.isPending} onClick={() => reject.mutate()}>{t({ ko: '제안 거절', en: 'Reject proposal' })}</Button> : null}
        {data?.status === 'pending' && data.canApply ? <Button disabled={!ready || Boolean(conflict) || apply.isPending || reject.isPending} onClick={() => apply.mutate()}>{t({ ko: '확인한 변경 반영', en: 'Apply reviewed changes' })}</Button> : null}
      </ModalFooter>
    </Modal>
  )
}

/** `bare`: the list alone (the post's 제안 tab), without the section heading. */
export function PostKnowledgeProposals({ postId, standalone = false, bare = false }: { postId?: number; standalone?: boolean; bare?: boolean }) {
  const { t, formatDateTime } = useI18n()
  const [picked, setPicked] = useState<string | null>(null)
  const [status, setStatus] = useState<'pending' | 'applied' | 'rejected'>('pending')
  const query = useInfiniteQuery({
    queryKey: [POSTS_QUERY_KEY, 'proposals', postId ?? 'all', status],
    queryFn: ({ pageParam }) => listPostKnowledgeProposals({ postId, status, offset: pageParam, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.offset + page.items.length < page.total ? page.offset + page.items.length : undefined,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const body = <>
      {query.isPending ? <LoadingState /> : query.isError ? <ErrorState size="compact" error={query.error} onRetry={() => void query.refetch()} /> : query.data ? <div>{items.map((item) => <ListRow key={item.id} asChild interactive><button type="button" onClick={() => setPicked(item.id)} className="w-full text-left"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.title}</span><span className="text-xs text-muted-foreground">{item.proposedByName} · {formatDateTime(item.createdAt)}</span></span><Badge variant="ghost">{item.kind === 'create' ? t({ ko: '새 문서', en: 'New document' }) : t({ ko: '수정', en: 'Update' })}</Badge></button></ListRow>)}{!items.length ? <EmptyState size="compact" title={t({ ko: '해당 제안이 없어', en: 'No matching proposals' })} /> : null}{query.hasNextPage ? <Button variant="ghost" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t({ ko: '더 보기', en: 'Load more' })}</Button> : null}</div> : null}
      {picked ? <KnowledgeProposalReview proposalId={picked} onClose={() => setPicked(null)} /> : null}
  </>
  if (bare) return <div>{body}</div>
  if (standalone) {
    return (
      <div>
        <div className="flex justify-end pb-1">
          <Select className="w-32" value={status} aria-label={t({ ko: '제안 상태', en: 'Proposal status' })} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="pending">{t({ ko: '검토 대기', en: 'Pending' })}</option><option value="applied">{t({ ko: '반영됨', en: 'Applied' })}</option><option value="rejected">{t({ ko: '거절됨', en: 'Rejected' })}</option></Select>
        </div>
        {body}
      </div>
    )
  }
  return (
    <Section heading={t({ ko: '검토할 변경 제안', en: 'Pending change proposals' })} bodyClassName="space-y-0">
      {body}
    </Section>
  )
}
