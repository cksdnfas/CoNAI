import { useMemo } from 'react'
import type { PostCategory, PostDetail } from '@conai/shared'
import { EyeOff, FileClock, Lock, Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleChip } from '@/components/ui/chip'
import { useI18n } from '@/i18n'
import { PostAuthorAvatar, PostAuthorName, useRelativeTime } from './post-author'
import { PostComments } from './post-comments'
import { mediaHashesOf, PostMarkdown } from './post-markdown'
import { PostMediaContext } from './post-media'

/** Ancestors first: 창작 › 일러스트. */
export function categoryPath(categories: PostCategory[], id: number | null) {
  const path: PostCategory[] = []
  const byId = new Map(categories.map((category) => [category.id, category]))
  for (let current = id === null ? undefined : byId.get(id); current && path.length < 8; current = current.parentId === null ? undefined : byId.get(current.parentId)) {
    path.unshift(current)
  }
  return path
}

/** One post: title, who wrote it and when, tags, the body with its media, then the comments. */
export function PostView({ post, categories, onTag, onCategory }: { post: PostDetail; categories: PostCategory[]; onTag: (tag: string) => void; onCategory: (id: number) => void }) {
  const { t, formatDateTime } = useI18n()
  const relative = useRelativeTime()
  const mediaContext = useMemo(() => ({ postId: post.id, mediaHashes: mediaHashesOf(post.body) }), [post.id, post.body])
  const path = categoryPath(categories, post.categoryId)
  const when = post.publishedAt ?? post.updatedAt

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-16">
      <header className="flex flex-col gap-3">
        {path.length ? (
          <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label={t({ ko: '카테고리', en: 'Category' })}>
            {path.map((category, index) => (
              <span key={category.id} className="inline-flex items-center gap-1">
                {index > 0 ? <span aria-hidden>›</span> : null}
                <Button variant="ghost" size="xs" className="px-1 font-normal text-muted-foreground" onClick={() => onCategory(category.id)}>{category.name}</Button>
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="flex items-start gap-2 text-2xl font-bold leading-snug [text-wrap:balance]">
          {post.pinned ? <Pin className="mt-1.5 size-4 shrink-0 text-primary" aria-label={t({ ko: '고정', en: 'Pinned' })} /> : null}
          <span>{post.title}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <PostAuthorAvatar author={post.author} size="md" />
          <PostAuthorName author={post.author} />
          <span aria-hidden>·</span>
          <span title={formatDateTime(when)}>{relative(when)}</span>
          {post.revision > 1 ? <span className="text-xs">· {t({ ko: '고침', en: 'edited' })}</span> : null}
          {post.status === 'draft' ? <span className="inline-flex items-center gap-1 text-xs"><FileClock className="size-3.5" />{t({ ko: '초안', en: 'Draft' })}</span> : null}
          {post.status === 'hidden' ? <span className="inline-flex items-center gap-1 text-xs text-destructive"><EyeOff className="size-3.5" />{t({ ko: '숨김', en: 'Hidden' })}</span> : null}
          {post.commentMode === 'closed' ? <span className="inline-flex items-center gap-1 text-xs"><Lock className="size-3.5" />{t({ ko: '댓글 닫힘', en: 'Comments closed' })}</span> : null}
        </div>
        {post.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {post.tags.map((tag) => (
              <ToggleChip key={tag} size="sm" pressed={false} onClick={() => onTag(tag)}>#{tag}</ToggleChip>
            ))}
          </div>
        ) : null}
      </header>
      <PostMediaContext.Provider value={mediaContext}>
        <PostMarkdown text={post.body} className="text-[0.95rem]" />
      </PostMediaContext.Provider>
      <hr className="border-line" />
      <PostMediaContext.Provider value={mediaContext}>
        <PostComments post={post} />
      </PostMediaContext.Provider>
    </article>
  )
}
