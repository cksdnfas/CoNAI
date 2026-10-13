import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { PostDetail, PostKnowledgeLinks, PostReviewIssue } from '@conai/shared'
import { Link as LinkIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, getPostKnowledgeLinks, listPostKnowledgeProposals, listPostKnowledgeReviewQueue } from '@/lib/api-posts'
import { useRelativeTime } from './post-author'
import { PostComments, type PostCommentDraft } from './post-comments'
import { PostKnowledgeEvaluations } from './post-knowledge-evaluations'
import { PostKnowledgeFeedback } from './post-knowledge-feedback'
import { KnowledgeReviewDialog, usePostKnowledgeState } from './post-knowledge-panel'
import { PostKnowledgeProposals } from './post-knowledge-proposals'
import { KnowledgeSources } from './post-knowledge-sources'
import type { KnowledgeSearchContext } from './post-knowledge-task-fit'
import { postRoute } from './post-links'
import type { PostTopicEvaluationState } from './post-topic-relevance'

type ReactionTab = 'comments' | 'info'

const TRIGGER = 'relative flex-none rounded-none px-0 pt-1 pb-2.5 text-sm font-semibold text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

function TabLabel({ label, count }: { label: string; count?: number | null }) {
  return <>{label}{count ? <span className="ml-1 font-normal text-muted-foreground/70 tabular-nums">{count}</span> : null}</>
}

/** One part of 문서 정보: a heading, then its content, or a single muted line when there is nothing. */
function InfoSection({ title, empty, children }: { title: string; empty?: string | null; children?: ReactNode }) {
  return (
    <section className="border-t border-line pt-4 pb-2 first:border-t-0 first:pt-2" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}{empty ? <span className="ml-2 font-normal text-muted-foreground">{empty}</span> : null}</h3>
      {empty ? null : children}
    </section>
  )
}

function ReviewIssues({ post, issues }: { post: PostDetail; issues: PostReviewIssue[] }) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const [resolving, setResolving] = useState<PostReviewIssue | null>(null)
  if (!issues.length) return null
  return (
    <div>
      {issues.map((issue) => (
        <div key={issue.id} className="flex items-start gap-3 border-t border-line py-3 first:border-t-0">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {issue.resolvedAt ? <Badge variant="success">{t({ ko: '해결됨', en: 'Resolved' })}</Badge> : <Badge variant="warning">{t({ ko: '열린 문제', en: 'Open' })}</Badge>}
              <span>{t({ ko: '{version}판', en: 'v{version}' }, { version: issue.contentVersion })} · {relative(issue.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{issue.reason}</p>
            {issue.evidenceQuote ? <blockquote className="whitespace-pre-wrap border-l-2 border-line pl-2.5 text-xs text-muted-foreground">{issue.evidenceQuote}</blockquote> : null}
            {issue.resolution ? <p className="whitespace-pre-wrap text-xs text-muted-foreground">{t({ ko: '해결: {reason}', en: 'Resolution: {reason}' }, { reason: issue.resolution })}</p> : null}
          </div>
          {post.knowledge?.canReview && !issue.resolvedAt ? <Button variant="ghost" size="xs" onClick={() => setResolving(issue)}>{t({ ko: '해결 확인', en: 'Resolve' })}</Button> : null}
        </div>
      ))}
      {resolving ? <KnowledgeReviewDialog post={post} action="resolve_issue" issue={resolving} onClose={() => setResolving(null)} /> : null}
    </div>
  )
}

function LinksList({ post, links }: { post: PostDetail; links: PostKnowledgeLinks }) {
  const { t } = useI18n()
  const replacement = post.knowledge?.replacementPostId ?? null
  const heading = (text: string) => <h4 className="pt-3 pb-1.5 text-xs font-medium text-muted-foreground">{text}</h4>
  return (
    <div>
      {links.sources.length ? <>{heading(t({ ko: '출처', en: 'Sources' }))}<KnowledgeSources sources={links.sources} /></> : null}
      {links.links.length ? <>{heading(t({ ko: '이 글이 참조', en: 'Links to' }))}<div className="flex flex-wrap gap-x-4 gap-y-1.5">{links.links.map((link, index) => link.postId
        ? <Link key={index} to={postRoute({ postId: link.postId, commentId: link.commentId })} className="inline-flex items-center gap-1 text-sm text-secondary-text hover:underline"><LinkIcon className="size-3.5" />{link.title}</Link>
        : <span key={index} className="text-sm text-muted-foreground line-through decoration-muted-foreground/50" title={t({ ko: '미연결', en: 'Unresolved' })}>{link.title}</span>)}</div></> : null}
      {links.backlinks.length ? <>{heading(t({ ko: '이 글을 참조', en: 'Linked from' }))}<div className="flex flex-wrap gap-x-4 gap-y-1.5">{links.backlinks.map((link) => <Link key={link.postId} to={postRoute({ postId: link.postId, commentId: null })} className="text-sm text-secondary-text hover:underline">{link.title}</Link>)}</div></> : null}
      {links.aliases.length ? <>{heading(t({ ko: '다른 이름', en: 'Aliases' }))}<p className="text-sm text-muted-foreground">{links.aliases.join(' · ')}</p></> : null}
      {replacement ? <>{heading(t({ ko: '대체 문서', en: 'Replacement' }))}<Link to={postRoute({ postId: replacement, commentId: null })} className="text-sm text-secondary-text hover:underline">#{replacement}</Link></> : null}
    </div>
  )
}

/**
 * Under the body: the comments, and for a knowledge document (or a post with topic scores) a 문서 정보 tab with its
 * feedback, review, links and change proposals. A plain post shows the comments alone, without a tab row.
 */
export function PostReactions({ post, topic, searchContext, commentDraft, setCommentDraft }: {
  post: PostDetail
  topic: PostTopicEvaluationState
  searchContext: KnowledgeSearchContext | null
  commentDraft: PostCommentDraft
  setCommentDraft: (update: (current: PostCommentDraft) => PostCommentDraft) => void
}) {
  const { t } = useI18n()
  const { active } = usePostKnowledgeState(post)
  const [picked, setPicked] = useState<ReactionTab>('comments')
  const canReview = post.knowledge?.canReview === true
  const showInfo = active || topic.value !== null
  const tab = showInfo ? picked : 'comments'
  // Open issues exist only on documents marked 재검토 필요, so the review queue is read only for those.
  const queue = useQuery({ queryKey: [POSTS_QUERY_KEY, 'review-queue'], queryFn: listPostKnowledgeReviewQueue, enabled: active && canReview && post.knowledge?.reviewStatus === 'needs_review' })
  const proposals = useQuery({ queryKey: [POSTS_QUERY_KEY, 'proposals-pending', post.id], queryFn: () => listPostKnowledgeProposals({ postId: post.id, status: 'pending', limit: 1 }), enabled: active })
  const links = useQuery({ queryKey: [POSTS_QUERY_KEY, 'links', post.id, post.revision], queryFn: () => getPostKnowledgeLinks(post.id), enabled: active && tab === 'info' })
  const issues = queue.data?.items.find((item) => item.post.id === post.id)?.issues ?? []
  const openIssues = issues.filter((issue) => !issue.resolvedAt).length
  const pendingProposals = proposals.data?.total ?? 0
  const linkCount = links.data ? links.data.sources.length + links.data.links.length + links.data.backlinks.length + links.data.aliases.length + (post.knowledge?.replacementPostId ? 1 : 0) : null

  if (!showInfo) return <PostComments post={post} draft={commentDraft} setDraft={setCommentDraft} />
  return (
    <Tabs value={tab} onValueChange={(next) => setPicked(next as ReactionTab)} className="gap-0">
      <TabsList aria-label={t({ ko: '반응', en: 'Responses' })} className="h-auto w-full justify-start gap-5 rounded-none border-b border-line bg-transparent p-0">
        <TabsTrigger value="comments" className={TRIGGER}><TabLabel label={t({ ko: '댓글', en: 'Comments' })} count={post.commentCount} /></TabsTrigger>
        <TabsTrigger value="info" className={TRIGGER}><TabLabel label={t({ ko: '문서 정보', en: 'Document' })} count={openIssues + pendingProposals} /></TabsTrigger>
      </TabsList>
      <TabsContent value="comments" className="pt-2">
        <PostComments post={post} draft={commentDraft} setDraft={setCommentDraft} hideHeading />
      </TabsContent>
      <TabsContent value="info" className="pt-1">
        <InfoSection title={t({ ko: '평가', en: 'Feedback' })}>
          <PostKnowledgeFeedback post={post} topic={topic} searchContext={searchContext} />
        </InfoSection>
        {active ? <>
          <InfoSection title={t({ ko: '검토', en: 'Review' })}>
            <ReviewIssues post={post} issues={issues} />
            <PostKnowledgeEvaluations post={post} empty={!issues.length ? <p className="pt-1 text-sm text-muted-foreground">{t({ ko: '검토 기록이 없어', en: 'No reviews yet' })}</p> : null} />
          </InfoSection>
          <InfoSection title={t({ ko: '연결', en: 'Links' })} empty={linkCount === 0 ? t({ ko: '없어', en: 'None' }) : null}>
            {links.isPending ? <LoadingState /> : links.isError ? <ErrorState size="compact" error={links.error} onRetry={() => void links.refetch()} /> : <LinksList post={post} links={links.data} />}
          </InfoSection>
          <InfoSection title={t({ ko: '변경 제안', en: 'Change proposals' })} empty={proposals.isSuccess && pendingProposals === 0 ? t({ ko: '없어', en: 'None' }) : null}>
            <PostKnowledgeProposals postId={post.id} bare />
          </InfoSection>
        </> : null}
      </TabsContent>
    </Tabs>
  )
}
