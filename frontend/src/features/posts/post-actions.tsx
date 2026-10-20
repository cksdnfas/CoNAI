import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PostDetail } from '@conai/shared'
import { BookOpen, BookX, Download, FilePlus2, Flag, History, Link as LinkIcon, Pencil, RefreshCw, RotateCcw, Scale, ShieldCheck, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { invalidatePostScope, deletePost, exportPostKnowledge, restorePostKnowledge, trashPostKnowledge, updatePostKnowledge } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { usePostReferenceEntry } from './post-chat-links'
import { useJudgeEvaluation } from './post-knowledge-evaluations'
import { KnowledgeMetadataEditor, KnowledgeReviewDialog, type KnowledgeReviewAction, usePostKnowledgeState } from './post-knowledge-panel'
import { PostKnowledgePermanentDeleteDialog } from './post-knowledge-permanent-delete'
import { KnowledgeProposalEditor } from './post-knowledge-proposals'
import { PostKnowledgeVersionsDialog } from './post-knowledge-versions'
import { PostRevisionsDialog } from './post-revisions-dialog'
import { usePostTopicEvaluation } from './post-topic-relevance'
import { usePostPermissions } from './use-post-permissions'

type Dialog = 'revisions' | 'sources' | 'permanent-delete' | { review: KnowledgeReviewAction } | { proposal: 'create' | 'update' } | null

/**
 * The open post's toolbar: 고치기 and one ⋯ with every other action on the post (versions, knowledge review and
 * proposals, sources, export, designation, delete). A post in the trash shows 복원 instead of 고치기.
 */
export function PostActions({ post, onEdit, onGone }: { post: PostDetail; onEdit: () => void; onGone: () => void }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = usePostPermissions()
  const { featureEnabled, enabled, active } = usePostKnowledgeState(post)
  const topic = usePostTopicEvaluation(post)
  const judge = useJudgeEvaluation(post)
  const reference = usePostReferenceEntry({ postId: post.id, label: post.title })
  const [dialog, setDialog] = useState<Dialog>(null)
  const knowledge = post.knowledge ?? null
  const trashed = Boolean(knowledge?.deletedAt)
  const onError = (fallback: string) => (error: unknown) => showSnackbar({ tone: 'error', message: getErrorMessage(error, fallback) })
  const refresh = () => invalidatePostScope(queryClient, post.id, 'post')

  const remove = useMutation({
    mutationFn: async () => { if (knowledge) await trashPostKnowledge(post.id, post.revision); else await deletePost(post.id) },
    onSuccess: async () => { onGone(); await refresh() },
    onError: onError(t({ ko: '글을 지우지 못했어.', en: 'Could not delete the post.' })),
  })
  const restore = useMutation({
    mutationFn: () => restorePostKnowledge(post.id, post.revision),
    onSuccess: refresh,
    onError: onError(t({ ko: '문서를 복원하지 못했어.', en: 'Could not restore the document.' })),
  })
  const designate = useMutation({
    mutationFn: (next: boolean) => updatePostKnowledge(post.id, { expectedRevision: post.revision, enabled: next }),
    onSuccess: refresh,
    onError: onError(t({ ko: '지식 지정을 바꾸지 못했어.', en: 'Could not change knowledge status.' })),
  })
  const download = useMutation({
    mutationFn: () => exportPostKnowledge(post.id),
    onSuccess: (manifest) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `knowledge-${post.id}-v${manifest.contentVersion}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    onError: onError(t({ ko: '문서를 내보내지 못했어.', en: 'Could not export the document.' })),
  })

  const entries: ActionMenuEntry[] = trashed ? [
    post.canEdit ? { key: 'versions', icon: History, label: t({ ko: '이전 판', en: 'Earlier versions' }), onSelect: () => setDialog('revisions') } : null,
    '-',
    post.canEdit ? { key: 'purge', icon: Trash2, destructive: true, label: t({ ko: '영구 삭제', en: 'Delete permanently' }), onSelect: () => setDialog('permanent-delete') } : null,
  ] : [
    reference,
    post.canEdit && (knowledge || post.revision > 1) ? { key: 'versions', icon: History, label: t({ ko: '이전 판', en: 'Earlier versions' }), onSelect: () => setDialog('revisions') } : null,
    '-',
    featureEnabled && permissions.canWrite && enabled ? { key: 'propose', icon: Pencil, label: t({ ko: '수정 제안', en: 'Suggest a change' }), onSelect: () => setDialog({ proposal: 'update' }) } : null,
    featureEnabled && permissions.canWrite ? { key: 'draft', icon: FilePlus2, label: t({ ko: '이 글로 문서 초안', en: 'Draft a document from this post' }), onSelect: () => setDialog({ proposal: 'create' }) } : null,
    '-',
    active && knowledge?.canReview ? { key: 'verify', icon: ShieldCheck, label: t({ ko: '현재 판 검증', en: 'Verify current version' }), onSelect: () => setDialog({ review: 'verify' }) } : null,
    active && knowledge?.canEvaluate ? { key: 'request', icon: RotateCcw, label: t({ ko: '재검토 요청', en: 'Request review' }), onSelect: () => setDialog({ review: 'request_review' }) } : null,
    active && knowledge?.canEvaluate ? { key: 'report', icon: Flag, label: t({ ko: '오류 제보', en: 'Report an error' }), onSelect: () => setDialog({ review: 'report_error' }) } : null,
    active && judge.available ? { key: 'judge', icon: Scale, disabled: judge.pending, label: t({ ko: '판단모델로 다시 평가', en: 'Evaluate with the judge' }), onSelect: judge.request } : null,
    topic.value?.canRequest ? {
      key: 'topic', icon: topic.value.evaluatedAt ? RefreshCw : Sparkles, disabled: !topic.canRequest, onSelect: topic.request,
      label: topic.waiting ? t({ ko: '주제 관련도 평가 중', en: 'Evaluating topics' }) : topic.value.evaluatedAt ? t({ ko: '주제 관련도 다시 평가', en: 'Re-evaluate topics' }) : t({ ko: '주제 관련도 평가 요청', en: 'Evaluate topics' }),
    } : null,
    '-',
    active && post.canEdit ? { key: 'sources', icon: LinkIcon, label: t({ ko: '출처 고치기', en: 'Edit sources' }), onSelect: () => setDialog('sources') } : null,
    active ? { key: 'export', icon: Download, disabled: download.isPending, label: t({ ko: '내보내기', en: 'Export' }), onSelect: () => download.mutate() } : null,
    '-',
    featureEnabled && post.canEdit ? {
      key: 'designate', icon: enabled ? BookX : BookOpen, disabled: designate.isPending,
      label: enabled ? t({ ko: '지식 지정 해제', en: 'Remove designation' }) : t({ ko: '지식으로 지정', en: 'Designate as knowledge' }),
      onSelect: async () => {
        if (!enabled || await confirm({ title: t({ ko: '지식 문서 지정을 해제할까?', en: 'Remove knowledge designation?' }), description: t({ ko: '저장한 판과 평가 이력은 남아.', en: 'Saved versions and feedback remain.' }) })) designate.mutate(!enabled)
      },
    } : null,
    post.canEdit ? {
      key: 'delete', icon: Trash2, destructive: true, disabled: remove.isPending,
      label: knowledge ? t({ ko: '휴지통으로', en: 'Move to trash' }) : t({ ko: '지우기', en: 'Delete' }),
      onSelect: async () => {
        if (await confirm({
          title: knowledge ? t({ ko: '지식 문서를 휴지통으로 옮길까?', en: 'Move this knowledge document to trash?' }) : t({ ko: '이 글을 지울까?', en: 'Delete this post?' }),
          description: knowledge ? t({ ko: '본문·출처·평가 이력을 보존하고 복원할 수 있어.', en: 'The text, sources and feedback remain available for restoration.' }) : t({ ko: '댓글도 함께 지워져.', en: 'Its comments go too.' }),
          tone: 'destructive',
        })) remove.mutate()
      },
    } : null,
  ]

  return (
    <>
      {trashed ? (
        post.canEdit ? <IconButton variant="ghost" label={t({ ko: '휴지통에서 복원', en: 'Restore from trash' })} disabled={restore.isPending} onClick={() => restore.mutate()}><Undo2 /></IconButton> : null
      ) : post.canEdit ? (
        <IconButton variant="ghost" label={t({ ko: '고치기', en: 'Edit' })} onClick={onEdit}><Pencil /></IconButton>
      ) : null}
      <ActionMenuButton size="icon" entries={entries} label={t({ ko: '더 보기', en: 'More' })} />
      {dialog === 'revisions' ? knowledge ? <PostKnowledgeVersionsDialog post={post} onClose={() => setDialog(null)} /> : <PostRevisionsDialog post={post} onClose={() => setDialog(null)} /> : null}
      {dialog === 'sources' ? <KnowledgeMetadataEditor key={post.revision} post={post} onClose={() => setDialog(null)} /> : null}
      {dialog === 'permanent-delete' ? <PostKnowledgePermanentDeleteDialog post={post} onClose={() => setDialog(null)} onDeleted={onGone} /> : null}
      {dialog && typeof dialog === 'object' && 'review' in dialog ? <KnowledgeReviewDialog post={post} action={dialog.review} onClose={() => setDialog(null)} /> : null}
      {dialog && typeof dialog === 'object' && 'proposal' in dialog ? <KnowledgeProposalEditor post={post} mode={dialog.proposal} onClose={() => setDialog(null)} /> : null}
    </>
  )
}
