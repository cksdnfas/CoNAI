import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PostSummary } from '@conai/shared'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, listPosts } from '@/lib/api-posts'

/** Choosing a document stores its fixed ID, so renaming it never changes the link target. */
export function PostLinkPicker({ onPick, onClose }: { onPick: (post: PostSummary) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [input])
  const query = useQuery({ queryKey: [POSTS_QUERY_KEY, 'link-picker', search], queryFn: () => listPosts({ q: search, limit: 30 }) })
  return (
    <Modal open onClose={onClose} title={t({ ko: '문서 링크 넣기', en: 'Insert document link' })} size="normal" height="medium">
      <ModalBody>
        <Input autoFocus value={input} onChange={(event) => setInput(event.target.value)} aria-label={t({ ko: '문서 찾기', en: 'Find a document' })} placeholder={t({ ko: '제목이나 본문으로 찾아', en: 'Search by title or text' })} />
        {query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : (
          <div>
            {query.data.items.map((post) => (
              <ListRow key={post.id} asChild interactive>
                <button type="button" onClick={() => onPick(post)} className="w-full text-left">
                  <span className="min-w-0 flex-1 truncate">{post.title}</span>
                  <span className="text-xs text-muted-foreground">#{post.id}</span>
                </button>
              </ListRow>
            ))}
            {!query.data.items.length ? <p className="py-4 text-sm text-muted-foreground">{t({ ko: '찾은 문서가 없어', en: 'No matching documents' })}</p> : null}
          </div>
        )}
      </ModalBody>
    </Modal>
  )
}
