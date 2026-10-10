import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostDetail, PostRevision } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, listPostRevisions, updatePost } from '@/lib/api-posts'
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
  const revisionsQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'revisions', post.id, post.revision], queryFn: () => listPostRevisions(post.id) })
  const revisions = useMemo(() => revisionsQuery.data ?? [], [revisionsQuery.data])
  const [pickedRevision, setPickedRevision] = useState<number | null>(null)
  const picked: PostRevision | null = revisions.find((item) => item.revision === pickedRevision) ?? revisions[0] ?? null
  const mediaContext = useMemo(() => ({ postId: post.id, mediaHashes: mediaHashesOf(picked?.body ?? '') }), [post.id, picked?.body])
  const restore = useMutation({
    mutationFn: (revision: PostRevision) => updatePost(post.id, { title: revision.title, body: revision.body, expectedRevision: post.revision }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
      showSnackbar({ tone: 'info', message: t({ ko: '이전 판으로 되돌렸어.', en: 'Restored the earlier version.' }) })
      onClose()
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '되돌리지 못했어.', en: 'Could not restore.' })) }),
  })

  return (
    <Modal open onClose={onClose} title={t({ ko: '이전 판', en: 'Earlier versions' })} widthClassName="max-w-4xl">
      <ModalBody className="grid min-h-0 gap-4 md:grid-cols-[14rem_1fr]">
        <div className="flex max-h-[60vh] min-w-0 flex-col overflow-y-auto">
          {revisionsQuery.isPending ? <div className="h-24 animate-pulse rounded-sm bg-surface-low" /> : null}
          {revisionsQuery.isSuccess && revisions.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t({ ko: '남은 이전 판이 없어', en: 'No earlier versions' })}</p> : null}
          {revisions.map((item) => (
            <ListRow key={item.revision} asChild interactive size="sm" selected={item.revision === picked?.revision}>
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
          {picked ? (
            <>
              <h3 className="text-lg font-bold leading-snug">{picked.title}</h3>
              <PostMediaContext.Provider value={mediaContext}>
                <PostMarkdown text={picked.body} className="text-sm" />
              </PostMediaContext.Provider>
            </>
          ) : null}
        </article>
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
