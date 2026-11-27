import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import { artStyleThumbnailUrl, createArtStyle, deleteArtStyle, invalidateArtStyles, isArtStyleNameConflict, isArtStyleRevisionConflict, updateArtStyle } from '@/lib/api-art-styles'
import { dismissChatProposal, markChatProposalSaved, type CodexChatToolCall } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatMediaAttachments } from './chat-media-picker'
import { useAutoApproveCard } from './chat-auto-approve'
import { ChatProfileImage } from './chat-profile-image'
import { codexChatThreadQueryKey } from './codex-chat-context'
import { ProposalFooter, ProposalFrame, ProposalRow } from './chat-proposal-parts'

type StyleProposal = Extract<NonNullable<CodexChatToolCall['proposal']>, { kind: 'art_style' }>

/**
 * An art style change the chat proposed (`propose_art_style`): create a style, change some of its fields against its
 * revision, or delete it. A person with the edit right (the delete right to delete) applies it here through the art style REST with their own
 * session (a taken title shows on the card); the proposal is then marked saved.
 */
export function ChatArtStyleProposalCard({ proposal, threadId }: { proposal: StyleProposal; threadId?: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const canEdit = permissions.canEdit
  const { canViewImages } = useImagePermissions()
  const [state, setState] = useState<'saved' | 'dismissed' | null>(null)
  const [savedId, setSavedId] = useState<number | null>(proposal.savedId ?? null)
  const [nameError, setNameError] = useState<string | null>(null)
  const saved = state === 'saved' || proposal.saved === true || proposal.savedId != null
  const dismissed = !saved && (state === 'dismissed' || proposal.dismissed === true)
  const deleting = proposal.action === 'delete_style'
  const input = proposal.action === 'save_style' ? proposal.input : null
  const refreshThread = () => threadId === undefined ? Promise.resolve() : queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) })

  const apply = useMutation({
    mutationFn: async () => {
      if (proposal.action === 'delete_style') {
        // The card names one stored version; the server refuses the delete when the style changed since.
        await deleteArtStyle(proposal.styleId, proposal.revision)
        await markChatProposalSaved(proposal.id, proposal.styleId)
        void invalidateArtStyles(queryClient, { styleIds: [proposal.styleId], listsChanged: true })
        return proposal.styleId
      }
      const result = proposal.styleId === null
        ? await createArtStyle({ ...proposal.input, title: proposal.input.title ?? proposal.title })
        : await updateArtStyle(proposal.styleId, { ...proposal.input, revision: proposal.revision ?? -1 })
      await markChatProposalSaved(proposal.id, result.id)
      void invalidateArtStyles(queryClient, { styleIds: [result.id], listsChanged: proposal.styleId === null })
      return result.id
    },
    onSuccess: async (id) => { setState('saved'); setSavedId(id); setNameError(null); await refreshThread() },
    onError: (error) => {
      if (isArtStyleNameConflict(error)) { setNameError(getErrorMessage(error, t({ ko: '같은 이름의 스타일이 있어.', en: 'A style with this title exists.' }))); return }
      showSnackbar({
        message: isArtStyleRevisionConflict(error)
          ? t({ ko: '그사이 스타일이 바뀌었어. 지금 내용으로 다시 제안받아줘.', en: 'The style changed meanwhile. Ask for a new proposal against it.' })
          : getErrorMessage(error, t({ ko: '제안을 처리하지 못했어.', en: 'Could not process proposal.' })),
        tone: 'error',
      })
    },
  })
  const dismiss = useMutation({
    mutationFn: () => dismissChatProposal(proposal.id),
    onSuccess: async () => { setState('dismissed'); await refreshThread() },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '제안을 처리하지 못했어.', en: 'Could not process proposal.' })), tone: 'error' }),
  })
  const busy = apply.isPending || dismiss.isPending
  // Auto-approve: the sending tab saves the card as it arrives (chat-auto-approve); deletions wait for a click.
  useAutoApproveCard(proposal, canEdit && !deleting, saved || dismissed || busy, () => apply.mutateAsync())
  const none = t({ ko: '없음', en: 'None' })
  const header = deleting ? t({ ko: '그림 스타일 삭제 제안', en: 'Delete art style' })
    : proposal.styleId === null ? t({ ko: '새 그림 스타일 제안', en: 'New art style' }) : t({ ko: '그림 스타일 수정 제안', en: 'Art style update' })
  // Library picks preview as library media; images the style already holds from its own file route.
  const imageName = (index: number) => index === 0 ? t({ ko: '대표', en: 'Cover' }) : String(index + 1)
  const images = input?.images?.flatMap((image, index) => 'composite_hash' in image ? [{ name: imageName(index), compositeHash: image.composite_hash, mimeType: null }] : []) ?? []
  const heldImages = proposal.styleId !== null && canViewImages ? input?.images?.flatMap((image, index) => 'id' in image ? [{ name: imageName(index), id: image.id }] : []) ?? [] : []
  const openLink = !deleting && savedId !== null ? `/characters?view=styles&style=${savedId}` : null

  return (
    <ProposalFrame>
      <div className="flex min-w-0 items-baseline gap-2"><span className="shrink-0 text-xs font-semibold text-muted-foreground">{header}</span><span className="min-w-0 truncate text-xs">{proposal.title}</span></div>
      {input ? (
        <div className="space-y-1.5">
          {input.title !== undefined && proposal.styleId !== null ? <ProposalRow label={t({ ko: '제목', en: 'Title' })}>{input.title}</ProposalRow> : null}
          {input.description !== undefined ? <ProposalRow label={t({ ko: '설명', en: 'Description' })}>{input.description || '—'}</ProposalRow> : null}
          {input.badges !== undefined ? <ProposalRow label={t({ ko: '배지', en: 'Badges' })}>{input.badges.join(', ') || none}</ProposalRow> : null}
          {input.keywords !== undefined ? <ProposalRow label={t({ ko: '검색어', en: 'Keywords' })}>{input.keywords.join(', ') || none}</ProposalRow> : null}
          {input.positive !== undefined ? <ProposalRow label={t({ ko: '긍정', en: 'Positive' })}>{input.positive || '—'}</ProposalRow> : null}
          {input.negative !== undefined ? <ProposalRow label={t({ ko: '부정', en: 'Negative' })}>{input.negative || '—'}</ProposalRow> : null}
          {input.images !== undefined ? <ProposalRow label={t({ ko: '이미지', en: 'Images' })}>{input.images.length ? t({ ko: '{count}장', en: '{count} images' }, { count: input.images.length }) : t({ ko: '모두 빼기', en: 'Remove all' })}</ProposalRow> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t({ ko: '스타일과 참조 이미지가 함께 지워져.', en: 'The style and its reference images are deleted.' })}</p>
      )}
      {heldImages.length && proposal.styleId !== null ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {heldImages.map((image) => (
            <div key={image.id} className="flex w-24 flex-col overflow-hidden rounded-sm bg-surface-high">
              <span className="flex h-20 w-full items-center justify-center"><ChatProfileImage src={artStyleThumbnailUrl(proposal.styleId!, image.id)} className="size-full object-cover" /></span>
              <span className="truncate px-1 py-1 text-2xs">{image.name}</span>
            </div>
          ))}
        </div>
      ) : null}
      {images.length ? <ChatMediaAttachments items={images} /> : null}
      {nameError ? <p role="alert" className="text-xs text-destructive">{nameError}</p> : null}
      {saved || dismissed ? (
        <ProposalFooter status>
          <span>{dismissed ? t({ ko: '거절됨', en: 'Dismissed' }) : deleting ? t({ ko: '삭제됨', en: 'Deleted' }) : t({ ko: '저장됨', en: 'Saved' })}</span>
          {openLink && permissions.canRead ? <Link to={openLink} className="text-primary-text hover:underline">{t({ ko: '스타일 열기', en: 'Open style' })}</Link> : null}
        </ProposalFooter>
      ) : canEdit ? (
        <ProposalFooter>
          <span className="flex-1" />
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>{t({ ko: '거절', en: 'Dismiss' })}</Button>
          <Button size="xs" variant={deleting ? 'destructive' : 'default'} disabled={busy} onClick={() => apply.mutate()}>
            {apply.isPending ? <Spinner className="size-3" /> : null}
            {deleting ? t({ ko: '삭제', en: 'Delete' }) : t({ ko: '저장', en: 'Save' })}
          </Button>
        </ProposalFooter>
      ) : null}
    </ProposalFrame>
  )
}
