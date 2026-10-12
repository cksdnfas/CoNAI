import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { PostDetail, PostKnowledgeLinks, PostReviewIssue } from '@conai/shared'
import { Link as LinkIcon, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, getPostKnowledgeLinks, listPostKnowledgeReviewQueue } from '@/lib/api-posts'
import { useRelativeTime } from './post-author'
import { PostComments, type PostCommentDraft } from './post-comments'
import { useJudgeEvaluation, PostKnowledgeEvaluations } from './post-knowledge-evaluations'
import { PostKnowledgeFeedback } from './post-knowledge-feedback'
import { KnowledgeReviewDialog, usePostKnowledgeState, usePostQuality } from './post-knowledge-panel'
import { PostKnowledgeProposals } from './post-knowledge-proposals'
import { KnowledgeSources } from './post-knowledge-sources'
import type { KnowledgeSearchContext } from './post-knowledge-task-fit'
import { postRoute } from './post-links'
import type { PostTopicEvaluationState } from './post-topic-relevance'

type ReactionTab = 'comments' | 'feedback' | 'review' | 'links' | 'proposals'

const TRIGGER = 'relative flex-none rounded-none px-0 pt-1 pb-2.5 text-sm font-semibold text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

function TabLabel({ label, count }: { label: string; count?: number | null }) {
  return <>{label}{count ? <span className="ml-1 font-normal text-muted-foreground/70 tabular-nums">{count}</span> : null}</>
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
}

function ReviewTab({ post, issues, loading }: { post: PostDetail; issues: PostReviewIssue[]; loading: boolean }) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const [resolving, setResolving] = useState<PostReviewIssue | null>(null)
  return (
    <div>
      {loading ? <LoadingState /> : issues.length ? (
        <section aria-label={t({ ko: '제보된 문제', en: 'Reported issues' })}>
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
        </section>
      ) : null}
      <PostKnowledgeEvaluations post={post} empty={!loading && !issues.length ? <Muted>{t({ ko: '검토 기록이 없어', en: 'No reviews yet' })}</Muted> : null} />
      {resolving ? <KnowledgeReviewDialog post={post} action="resolve_issue" issue={resolving} onClose={() => setResolving(null)} /> : null}
    </div>
  )
}

function LinksTab({ post, links }: { post: PostDetail; links: PostKnowledgeLinks }) {
  const { t } = useI18n()
  const replacement = post.knowledge?.replacementPostId ?? null
  if (!links.sources.length && !links.links.length && !links.backlinks.length && !links.aliases.length && !replacement) return <Muted>{t({ ko: '연결된 게 없어', en: 'Nothing linked' })}</Muted>
  const heading = (text: string) => <h3 className="pt-5 pb-2 text-sm font-semibold first:pt-2">{text}</h3>
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
 * Everything people (and AI) said about the post, as text tabs under the body: comments, feedback, reviews, links
 * and change proposals. Each tab loads its data when first opened.
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
  const quality = usePostQuality(post, active)
  const judge = useJudgeEvaluation(post)
  const canReview = post.knowledge?.canReview === true
  const visible: Record<ReactionTab, boolean> = { comments: true, feedback: active || topic.value !== null, review: active, links: active, proposals: active }
  const tab = visible[picked] ? picked : 'comments'
  const links = useQuery({ queryKey: [POSTS_QUERY_KEY, 'links', post.id, post.revision], queryFn: () => getPostKnowledgeLinks(post.id), enabled: active && tab === 'links' })
  const queue = useQuery({ queryKey: [POSTS_QUERY_KEY, 'review-queue'], queryFn: listPostKnowledgeReviewQueue, enabled: active && canReview && tab === 'review' })
  const issues = queue.data?.items.find((item) => item.post.id === post.id)?.issues ?? []
  const linkCount = links.data ? links.data.sources.length + links.data.links.length + links.data.backlinks.length : null
  const items: Array<{ value: ReactionTab; label: ReactNode }> = [
    { value: 'comments', label: <TabLabel label={t({ ko: '댓글', en: 'Comments' })} count={post.commentCount} /> },
    { value: 'feedback', label: <TabLabel label={t({ ko: '평가', en: 'Feedback' })} count={quality.data?.reasons.length} /> },
    { value: 'review', label: <TabLabel label={t({ ko: '검토', en: 'Review' })} count={queue.data ? issues.filter((issue) => !issue.resolvedAt).length : null} /> },
    { value: 'links', label: <TabLabel label={t({ ko: '연결', en: 'Links' })} count={linkCount} /> },
    { value: 'proposals', label: <TabLabel label={t({ ko: '제안', en: 'Proposals' })} /> },
  ]
  const showJudge = judge.available && (tab === 'feedback' || tab === 'review')
  return (
    <Tabs value={tab} onValueChange={(next) => setPicked(next as ReactionTab)} className="gap-0">
      <div className="flex items-center gap-2 border-b border-line">
        <TabsList aria-label={t({ ko: '반응', en: 'Responses' })} className="h-auto flex-1 justify-start gap-5 rounded-none bg-transparent p-0">
          {items.filter((item) => visible[item.value]).map((item) => <TabsTrigger key={item.value} value={item.value} className={TRIGGER}>{item.label}</TabsTrigger>)}
        </TabsList>
        {showJudge ? <IconButton variant="ghost" size="icon-sm" disabled={judge.pending} label={t({ ko: '판단모델로 다시 평가', en: 'Evaluate with the judge' })} onClick={judge.request}><RefreshCw /></IconButton> : null}
      </div>
      <TabsContent value="comments" className="pt-2">
        <PostComments post={post} draft={commentDraft} setDraft={setCommentDraft} hideHeading />
      </TabsContent>
      {visible.feedback ? <TabsContent value="feedback"><PostKnowledgeFeedback post={post} topic={topic} searchContext={searchContext} /></TabsContent> : null}
      {visible.review ? <TabsContent value="review" className="pt-2"><ReviewTab post={post} issues={issues} loading={canReview && queue.isPending} /></TabsContent> : null}
      {visible.links ? <TabsContent value="links">
        {links.isPending ? <LoadingState /> : links.isError ? <ErrorState size="compact" error={links.error} onRetry={() => void links.refetch()} /> : <LinksTab post={post} links={links.data} />}
      </TabsContent> : null}
      {visible.proposals ? <TabsContent value="proposals" className="pt-2"><PostKnowledgeProposals postId={post.id} bare /></TabsContent> : null}
    </Tabs>
  )
}
