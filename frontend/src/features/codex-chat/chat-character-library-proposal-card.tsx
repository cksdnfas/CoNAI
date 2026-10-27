import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { folderPath, refreshCharacterViews, useCharacterFolders } from '@/features/characters/character-library-shared'
import { useI18n } from '@/i18n'
import {
  createCharacterSetting,
  deleteCharacterFolder,
  deleteCharacterSetting,
  getCharacterFolderDeletePreview,
  getCharacterSettingDeletePreview,
  isCharacterRevisionConflict,
  updateCharacterSetting,
} from '@/lib/api-character-library'
import { dismissChatProposal, markChatProposalSaved, type CodexChatToolCall } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatMediaAttachments } from './chat-media-picker'
import { codexChatThreadQueryKey } from './codex-chat-context'
import { ProposalFooter, ProposalFrame } from './chat-proposal-parts'

type LibraryProposal = Extract<NonNullable<CodexChatToolCall['proposal']>, { kind: 'character_library' }>

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 text-xs">
      <span className="pt-px text-muted-foreground">{label}</span>
      <div className="max-h-28 min-w-0 overflow-auto whitespace-pre-wrap break-words">{children}</div>
    </div>
  )
}

/**
 * A character library change the chat proposed (`propose_character_library`): save a setting (new or against its
 * revision), or delete a setting or a folder with what goes with it. A person with `characters.edit` applies it here
 * through the library REST with their own session; the proposal is then marked saved.
 */
export function ChatCharacterLibraryProposalCard({ proposal, threadId }: { proposal: LibraryProposal; threadId?: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const canView = permissions.has('characters.view')
  const canEdit = permissions.has('characters.edit')
  const [state, setState] = useState<'saved' | 'dismissed' | null>(null)
  const [savedId, setSavedId] = useState<number | null>(proposal.savedId ?? null)
  const saved = state === 'saved' || proposal.saved === true || proposal.savedId != null
  const dismissed = !saved && (state === 'dismissed' || proposal.dismissed === true)
  const input = proposal.action === 'save_setting' ? proposal.input : null
  const foldersQuery = useCharacterFolders(canView && input?.folderId !== undefined)
  const previewQuery = useQuery({
    queryKey: ['character-library-delete-preview', proposal.action, proposal.action === 'delete_folder' ? proposal.folderId : proposal.action === 'delete_setting' ? proposal.settingId : 0],
    queryFn: () => proposal.action === 'delete_folder' ? getCharacterFolderDeletePreview(proposal.folderId) : getCharacterSettingDeletePreview((proposal as Extract<LibraryProposal, { action: 'delete_setting' }>).settingId),
    enabled: canEdit && proposal.action !== 'save_setting' && !saved && !dismissed,
    retry: false,
  })
  const refreshThread = () => threadId === undefined ? Promise.resolve() : queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) })
  const onError = (error: unknown) => showSnackbar({
    message: isCharacterRevisionConflict(error)
      ? t({ ko: '그사이 외형 설정이 바뀌었어. 지금 내용으로 다시 제안받아줘.', en: 'The setting changed meanwhile. Ask for a new proposal against it.' })
      : getErrorMessage(error, t({ ko: '제안을 처리하지 못했어.', en: 'Could not process proposal.' })),
    tone: 'error',
  })

  const apply = useMutation({
    mutationFn: async () => {
      if (proposal.action === 'save_setting') {
        const result = proposal.settingId === null
          ? await createCharacterSetting({ ...proposal.input, folderId: proposal.input.folderId ?? null, name: proposal.input.name ?? proposal.settingName })
          : await updateCharacterSetting(proposal.settingId, { ...proposal.input, revision: proposal.revision ?? -1 })
        await markChatProposalSaved(proposal.id, result.id)
        void refreshCharacterViews(queryClient, { folderIds: [result.folderId], settingIds: [result.id] })
        return result.id
      }
      if (proposal.action === 'delete_setting') {
        // The card names one stored version; the server refuses the delete when the setting changed since.
        await deleteCharacterSetting(proposal.settingId, proposal.revision)
        await markChatProposalSaved(proposal.id, proposal.settingId)
        void refreshCharacterViews(queryClient, { folderIds: [], settingIds: [proposal.settingId] })
        return proposal.settingId
      }
      await deleteCharacterFolder(proposal.folderId)
      await markChatProposalSaved(proposal.id, proposal.folderId)
      void refreshCharacterViews(queryClient, { folderIds: [proposal.folderId], settingIds: [], foldersChanged: true })
      return proposal.folderId
    },
    onSuccess: async (id) => { setState('saved'); setSavedId(id); await refreshThread() },
    onError,
  })
  const dismiss = useMutation({ mutationFn: () => dismissChatProposal(proposal.id), onSuccess: async () => { setState('dismissed'); await refreshThread() }, onError })
  const busy = apply.isPending || dismiss.isPending
  const deleting = proposal.action !== 'save_setting'

  const byId = new Map((foldersQuery.data ?? []).map((folder) => [folder.id, folder]))
  const folderLabel = (folderId: number | null) => [t({ ko: '최상위', en: 'Top level' }), ...folderPath(byId, folderId).map((folder) => folder.name)].join(' / ')
  const images = input ? [
    ...(input.referenceHash ? [{ name: t({ ko: '기준 이미지', en: 'Reference image' }), compositeHash: input.referenceHash, mimeType: null }] : []),
    ...(input.avatarHash && input.avatarHash !== input.referenceHash ? [{ name: t({ ko: '아바타', en: 'Avatar' }), compositeHash: input.avatarHash, mimeType: null }] : []),
  ] : []
  const preview = previewQuery.data
  const header = proposal.action === 'save_setting'
    ? (proposal.settingId === null ? t({ ko: '새 외형 설정 제안', en: 'New appearance setting' }) : t({ ko: '외형 설정 수정 제안', en: 'Appearance setting update' }))
    : proposal.action === 'delete_setting' ? t({ ko: '외형 설정 삭제 제안', en: 'Delete appearance setting' }) : t({ ko: '폴더 삭제 제안', en: 'Delete folder' })
  const name = proposal.action === 'delete_folder' ? proposal.folderName : proposal.settingName
  const openLink = proposal.action === 'save_setting' && savedId !== null ? `/characters?setting=${savedId}` : null

  return (
    <ProposalFrame>
      <div className="flex min-w-0 items-baseline gap-2"><span className="shrink-0 text-xs font-semibold text-muted-foreground">{header}</span><span className="min-w-0 truncate text-xs">{name}</span></div>
      {input ? (
        <div className="space-y-1.5">
          {input.name !== undefined ? <Row label={t({ ko: '이름', en: 'Name' })}>{input.name}</Row> : null}
          {input.folderId !== undefined ? <Row label={t({ ko: '폴더', en: 'Folder' })}>{folderLabel(input.folderId)}</Row> : null}
          {input.appearance !== undefined ? <Row label={t({ ko: '외형', en: 'Appearance' })}>{input.appearance || '—'}</Row> : null}
          {input.referenceHash === null ? <Row label={t({ ko: '기준 이미지', en: 'Reference image' })}>{t({ ko: '비우기', en: 'Clear' })}</Row> : null}
          {input.avatarHash === null ? <Row label={t({ ko: '아바타', en: 'Avatar' })}>{t({ ko: '비우기', en: 'Clear' })}</Row> : null}
          {input.avatarCrop ? <Row label={t({ ko: '아바타 자르기', en: 'Avatar crop' })}>{`${Math.round(input.avatarCrop.x)}%, ${Math.round(input.avatarCrop.y)}% · ×${input.avatarCrop.scale.toFixed(2)}`}</Row> : null}
        </div>
      ) : preview ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {proposal.action === 'delete_folder' ? <p>{t({ ko: '폴더 {folders}개와 외형 설정 {settings}개가 함께 지워져.', en: '{folders} folders and {settings} settings will be deleted.' }, { folders: preview.folders, settings: preview.settings })}</p> : null}
          {preview.linkedProfiles.length ? <p>{t({ ko: '연결된 프로필 {count}개({names})는 지금 값의 사본을 유지해.', en: '{count} linked profiles ({names}) keep a copy of the values.' }, { count: preview.linkedProfiles.length, names: preview.linkedProfiles.slice(0, 5).map((profile) => profile.name).join(', ') })}</p> : null}
        </div>
      ) : previewQuery.isError ? (
        <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
          {getErrorMessage(previewQuery.error, t({ ko: '지워질 내용을 확인하지 못했어.', en: 'Could not check what gets deleted.' }))}
          <Button size="xs" variant="ghost" disabled={previewQuery.isFetching} onClick={() => void previewQuery.refetch()}>{t({ ko: '다시 시도', en: 'Retry' })}</Button>
        </div>
      ) : previewQuery.isPending && previewQuery.fetchStatus !== 'idle' ? <Spinner className="size-3" /> : null}
      {images.length ? <ChatMediaAttachments items={images} /> : null}
      {saved || dismissed ? (
        <ProposalFooter status>
          <span>{dismissed ? t({ ko: '거절됨', en: 'Dismissed' }) : deleting ? t({ ko: '삭제됨', en: 'Deleted' }) : t({ ko: '저장됨', en: 'Saved' })}</span>
          {openLink && canView ? <Link to={openLink} className="text-primary hover:underline">{t({ ko: '라이브러리에서 열기', en: 'Open in library' })}</Link> : null}
        </ProposalFooter>
      ) : canEdit ? (
        <ProposalFooter>
          <span className="flex-1" />
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>{t({ ko: '거절', en: 'Dismiss' })}</Button>
          <Button size="xs" variant={deleting ? 'destructive' : 'default'} disabled={busy || (deleting && !preview)} onClick={() => apply.mutate()}>
            {apply.isPending ? <Spinner className="size-3" /> : deleting ? <Trash2 /> : <Check />}
            {deleting ? t({ ko: '삭제', en: 'Delete' }) : t({ ko: '저장', en: 'Save' })}
          </Button>
        </ProposalFooter>
      ) : null}
    </ProposalFrame>
  )
}
