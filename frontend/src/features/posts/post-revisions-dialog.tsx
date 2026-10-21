import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostDetail, PostRevision } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ListRow } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, invalidatePostScope, getPostRevision, listPostRevisionSummaries, updatePost } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { useRelativeTime } from './post-author'
import { mediaHashesOf, PostMarkdown } from './post-markdown'
import { PostMediaContext } from './post-media'

/**
 * A post's earlier versions (the newest 20), each shown as it read; restoring one is an ordinary edit, so the version
 * it replaces is kept in turn and the restore can itself be undone.
 */
export function PostRevisionsDialog({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const revisionsQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'revisions', post.id, post.revision, 'summary'], queryFn: ({ signal }) => listPostRevisionSummaries(post.id, signal) })
  const revisions = useMemo(() => revisionsQuery.data ?? [], [revisionsQuery.data])
  const [pickedRevision, setPickedRevision] = useState<number | null>(null)
  const selected = revisions.find((item) => item.revision === pickedRevision) ?? revisions[0] ?? null
  const revisionQuery = useQuery({
    queryKey: [POSTS_QUERY_KEY, 'revisions', post.id, post.revision, selected?.revision],
    queryFn: ({ signal }) => getPostRevision(post.id, selected!.revision, signal),
    enabled: selected !== null,
  })
  const picked = revisionQuery.data ?? null
  const mediaContext = useMemo(() => ({ postId: post.id, mediaHashes: mediaHashesOf(picked?.body ?? '') }), [post.id, picked?.body])
  const restore = useMutation({
    mutationFn: (revision: PostRevision) => updatePost(post.id, { title: revision.title, body: revision.body, expectedRevision: post.revision }),
    onSuccess: async () => {
      await invalidatePostScope(queryClient, post.id, 'post')
      showSnackbar({ tone: 'info', message: t({ ko: '이전 판으로 되돌렸어.', en: 'Restored the earlier version.' }) })
      onClose()
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '되돌리지 못했어.', en: 'Could not restore.' })) }),
  })

  return (
    <Modal open onClose={onClose} title={t({ ko: '이전 판', en: 'Earlier versions' })} widthClassName="max-w-4xl">
      <ModalBody spacing="none">
        <div className="grid min-h-0 gap-4 md:grid-cols-[14rem_1fr]">
        <div className="flex max-h-[60vh] min-w-0 flex-col overflow-y-auto">
          {revisionsQuery.isPending ? <div className="h-24 animate-pulse rounded-sm bg-surface-low" /> : null}
          {revisionsQuery.isError ? <ErrorState size="compact" error={revisionsQuery.error} onRetry={() => void revisionsQuery.refetch()} /> : null}
          {revisionsQuery.isSuccess && revisions.length === 0 ? <EmptyState size="compact" title={t({ ko: '남은 이전 판이 없어', en: 'No earlier versions' })} /> : null}
          {revisions.map((item) => (
            <ListRow key={item.revision} asChild interactive size="sm" selected={item.revision === selected?.revision}>
              <button type="button" className="w-full" onClick={() => setPickedRevision(item.revision)}>
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                  <span className="whitespace-nowrap text-sm font-semibold">{t({ ko: '{revision}판', en: 'Version {revision}' }, { revision: item.revision })}</span>
                  {/* Who replaced this version, and when. */}
                  <span className="w-full truncate text-xs text-muted-foreground">{t({ ko: '{name} 고침', en: 'Edited by {name}' }, { name: item.editedBy })} · {relative(item.createdAt)}</span>
                </span>
              </button>
            </ListRow>
          ))}
        </div>
        <article className="flex max-h-[60vh] min-w-0 flex-col gap-3 overflow-y-auto">
          {selected && revisionQuery.isPending ? <LoadingState /> : null}
          {revisionQuery.isError ? <ErrorState size="compact" error={revisionQuery.error} onRetry={() => void revisionQuery.refetch()} /> : null}
          {picked ? (
            <>
              <h3 className="text-lg font-bold leading-snug">{picked.title}</h3>
              <PostMediaContext.Provider value={mediaContext}>
                <PostMarkdown text={picked.body} className="text-sm" />
              </PostMediaContext.Provider>
            </>
          ) : null}
        </article>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>{t({ ko: '닫기', en: 'Close' })}</Button>
        <Button size="sm" disabled={!picked || restore.isPending} onClick={async () => {
          if (!picked) return
          if (await confirm({ title: t({ ko: '{revision}판으로 되돌릴까?', en: 'Restore version {revision}?' }, { revision: picked.revision }), description: t({ ko: '제목과 본문이 이 판으로 바뀌고, 지금 판은 이전 판에 남아.', en: 'The title and text change back; the current version is kept here.' }) })) restore.mutate(picked)
        }}>{t({ ko: '이 판으로 되돌리기', en: 'Restore this version' })}</Button>
      </ModalFooter>
    </Modal>
  )
}
