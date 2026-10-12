import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostDetail } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, listPostKnowledgeVersions, restorePostKnowledgeVersion } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { KnowledgeSources } from './post-knowledge-sources'
import { mediaHashesOf, PostMarkdown } from './post-markdown'
import { PostMediaContext } from './post-media'

export function PostKnowledgeVersionsDialog({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const { t, formatDateTime } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: [POSTS_QUERY_KEY, 'knowledge-versions', post.id, post.knowledge?.contentVersion], queryFn: () => listPostKnowledgeVersions(post.id) })
  const [selected, setSelected] = useState<number | null>(null)
  const picked = query.data?.find((item) => item.contentVersion === selected) ?? query.data?.[0]
  const mediaContext = useMemo(() => ({ postId: post.id, mediaHashes: mediaHashesOf(picked?.body ?? ''), knowledgeContentVersion: picked?.contentVersion }), [post.id, picked?.body, picked?.contentVersion])
  const restore = useMutation({
    mutationFn: () => restorePostKnowledgeVersion(post.id, picked!.contentVersion, post.revision),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '내용 판을 복원하지 못했어.', en: 'Could not restore the content version.' })) }),
  })
  return (
    <Modal open onClose={onClose} title={t({ ko: '지식 내용 이력', en: 'Knowledge content history' })} size="wide" height="tall">
      <ModalBody className="grid gap-5 md:grid-cols-[12rem_1fr]">
        <div>{query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data?.map((version) => <ListRow key={version.contentVersion} asChild interactive selected={picked?.contentVersion === version.contentVersion}><button type="button" className="w-full text-left" onClick={() => setSelected(version.contentVersion)}><span><span className="block text-sm font-medium">{t({ ko: '내용 {version}판', en: 'Content version {version}' }, { version: version.contentVersion })}</span><span className="text-xs text-muted-foreground">{version.changedBy} · {formatDateTime(version.createdAt)}</span></span></button></ListRow>)}</div>
        {picked ? <article className="min-w-0 space-y-5"><h2 className="text-lg font-semibold">{picked.title}</h2><PostMediaContext.Provider value={mediaContext}><PostMarkdown text={picked.body} /></PostMediaContext.Provider><KnowledgeSources sources={picked.sources} /></article> : null}
      </ModalBody>
      <ModalFooter><Button variant="ghost" onClick={onClose}>{t({ ko: '닫기', en: 'Close' })}</Button>{post.canEdit ? <Button disabled={!picked || picked.contentVersion === post.knowledge?.contentVersion || restore.isPending} onClick={async () => { if (await confirm({ title: t({ ko: '선택한 내용 판으로 복원할까?', en: 'Restore the selected content version?' }), description: t({ ko: '제목·본문·출처를 함께 복원해. 검증은 다시 확인해야 해.', en: 'The title, text and sources restore together. Verification needs a new review.' }) })) restore.mutate() }}>{t({ ko: '이 내용 판 복원', en: 'Restore this content version' })}</Button> : null}</ModalFooter>
    </Modal>
  )
}
