import { useQuery } from '@tanstack/react-query'
import type { PostSummary } from '@conai/shared'
import { BookOpen, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, getPostKnowledgeSearchStatus, listPostKnowledgeReviewQueue } from '@/lib/api-posts'
import { PostKnowledgeStatus } from './post-knowledge-status'

function KnowledgeListSummary({ post }: { post: PostSummary }) {
  return <><span className="flex min-w-0 flex-1 flex-col gap-1.5"><span className="truncate font-semibold">{post.title}</span><PostKnowledgeStatus knowledge={post.knowledge} showVersion />{post.excerpt ? <span className="line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</span> : null}{post.matchedComment ? <span className="truncate text-xs text-muted-foreground">{post.matchedComment.author}: {post.matchedComment.excerpt}</span> : null}</span><span className="text-xs text-muted-foreground">#{post.id}</span></>
}

export function PostKnowledgeList({ posts, onOpen, onRestore, onPermanentDelete, isRestoring = false }: { posts: PostSummary[]; onOpen: (post: PostSummary) => void; onRestore?: (post: PostSummary) => void; onPermanentDelete?: (post: PostSummary) => void; isRestoring?: boolean }) {
  const { t } = useI18n()
  return <div>{posts.map((post) => post.knowledge?.deletedAt ? (
    <ListRow key={post.id} size="lg" trailing={post.canEdit ? <div className="flex flex-wrap items-center gap-2">{onRestore ? <Button variant="secondary" size="sm" disabled={isRestoring} onClick={() => onRestore(post)}><Undo2 />{t({ ko: '복원', en: 'Restore' })}</Button> : null}{onPermanentDelete ? <Button variant="destructive-ghost" size="sm" disabled={isRestoring} onClick={() => onPermanentDelete(post)}>{t({ ko: '영구 삭제', en: 'Delete permanently' })}</Button> : null}</div> : undefined}><KnowledgeListSummary post={post} /></ListRow>
  ) : <ListRow key={post.id} asChild interactive size="lg"><button type="button" className="w-full text-left" onClick={() => onOpen(post)}><KnowledgeListSummary post={post} /></button></ListRow>)}</div>
}

export function PostKnowledgeReviewList({ onOpen }: { onOpen: (post: PostSummary) => void }) {
  const { t } = useI18n()
  const query = useQuery({ queryKey: [POSTS_QUERY_KEY, 'review-queue'], queryFn: listPostKnowledgeReviewQueue })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data.items.length) return <EmptyState icon={BookOpen} title={t({ ko: '재검토할 문서가 없어', en: 'No documents waiting for review' })} />
  return <div>{query.data.items.map(({ post, issues }) => {
    const openIssues = issues.filter((issue) => !issue.resolvedAt)
    return <ListRow key={post.id} asChild interactive size="lg"><button type="button" className="w-full text-left" onClick={() => onOpen(post)}><span className="flex min-w-0 flex-1 flex-col gap-1.5"><span className="truncate font-semibold">{post.title}</span><PostKnowledgeStatus knowledge={post.knowledge} showVersion />{openIssues.slice(0, 2).map((issue) => <span key={issue.id} className="line-clamp-2 text-sm text-muted-foreground">{issue.reason}</span>)}</span>{openIssues.length ? <Badge variant="warning">{t({ ko: '열린 문제 {count}', en: '{count} open issues' }, { count: openIssues.length })}</Badge> : null}</button></ListRow>
  })}</div>
}

export function PostKnowledgeSearchMode() {
  const { t } = useI18n()
  const query = useQuery({ queryKey: [POSTS_QUERY_KEY, 'knowledge-search-status'], queryFn: getPostKnowledgeSearchStatus, staleTime: 30_000, refetchInterval: (current) => current.state.data?.state === 'indexing' ? 5000 : false })
  if (!query.data) return null
  const status = query.data
  return <p className="text-xs text-muted-foreground">{status.state === 'ready' ? t({ ko: '키워드 + 의미 검색', en: 'Keyword + semantic search' }) : status.state === 'indexing' || status.state === 'partial' ? t({ ko: '키워드 검색 · 의미 색인 {indexed}/{total}', en: 'Keyword search · semantic index {indexed}/{total}' }, { indexed: status.indexed, total: status.total }) : status.state === 'unavailable' ? t({ ko: '키워드 검색 · 의미 검색 준비 안 됨', en: 'Keyword search · semantic search unavailable' }) : t({ ko: '키워드 검색', en: 'Keyword search' })}</p>
}
