import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Crop, Sparkles, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { useI18n } from '@/i18n'
import { draftChatAppearance, type ChatAssetApplyResult, type ChatAssetBatch, type ChatProfile } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatAssetBatchModal } from './chat-asset-batch-modal'
import { ChatProfileAssetGroups } from './chat-profile-asset-groups'
import { ChatProfileAssetInput } from './chat-profile-asset-input'
import { ChatProfileAvatarCrop } from './chat-profile-avatar-crop'
import { EditorGroup, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { draftProfileAssetUrl } from './chat-profile-images'

/** Reference, avatar and appearance share the profile editor's unsaved draft. */
export function ChatProfileAppearancePanel({ draft, patch, profile, onBusyChange, busy, batchId, onBatchChange, onPrepareAssets, onAssetsApplied }: {
  draft: Draft
  patch: PatchDraft
  profile: ChatProfile | null
  onBusyChange: (busy: boolean) => void
  busy: boolean
  batchId: number | null
  onBatchChange: (id: number) => void
  onPrepareAssets: () => Promise<ChatProfile>
  onAssetsApplied: (result: ChatAssetApplyResult, batch: ChatAssetBatch, profile?: ChatProfile) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const [cropOpen, setCropOpen] = useState(false)
  const [assetsMode, setAssetsMode] = useState<'reference' | 'all' | null>(null)
  const active = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const reportBusy = useRef(onBusyChange)
  reportBusy.current = onBusyChange
  useEffect(() => {
    active.current = true
    return () => { active.current = false; if (controller.current) { controller.current.abort(); controller.current = null; reportBusy.current(false) } }
  }, [])
  const appearance = useMutation({
    mutationFn: () => { controller.current = new AbortController(); reportBusy.current(true); return draftChatAppearance(draft, controller.current.signal) },
    onSuccess: (result) => { if (active.current) patch({ appearance: result.appearance }) },
    onError: (error) => { if (active.current) showSnackbar({ message: getErrorMessage(error, t({ ko: '외형 초안을 쓰지 못했어.', en: 'Could not draft appearance.' })), tone: 'error' }) },
    onSettled: () => { if (controller.current) { controller.current = null; reportBusy.current(false) } },
  })
  const writeAppearance = async () => {
    if (draft.appearance?.trim() && !await confirm({ title: t({ ko: '외형 설명 덮어쓰기', en: 'Replace appearance' }), description: t({ ko: '지금 설명을 새 초안으로 바꿀까?', en: 'Replace the current description with a new draft?' }), confirmLabel: t({ ko: '초안 쓰기', en: 'Draft' }) })) return
    if (active.current) appearance.mutate()
  }
  const referenceUrl = draftProfileAssetUrl(draft, profile, 'reference')
  const avatarUrl = draftProfileAssetUrl(draft, profile, 'avatar')
  return <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
    <EditorGroup label={t({ ko: '기준 이미지', en: 'Reference image' })}>
      <div className="relative h-[300px] w-[220px] max-w-full overflow-hidden rounded-lg border border-dashed border-line">
        <ChatProfileImage src={referenceUrl} />
        {draft.referenceHash ? <IconButton size="icon-xs" variant="secondary" disabled={busy} className="absolute right-1.5 top-1.5" label={t({ ko: '기준 이미지 지우기', en: 'Remove reference image' })} onClick={() => patch({ referenceHash: null })}><X /></IconButton> : null}
      </div>
      <div className="flex items-center gap-1"><ChatProfileAssetInput characterName={draft.name} onChange={(referenceHash) => patch({ referenceHash })} onBusyChange={onBusyChange} busy={busy} /><IconButton size="icon-sm" variant="ghost" disabled={busy} label={t({ ko: '기준 이미지 생성하기', en: 'Generate reference image' })} onClick={() => setAssetsMode('reference')}><Sparkles /></IconButton></div>
    </EditorGroup>
    <div className="space-y-6">
      <EditorGroup label={t({ ko: '아바타', en: 'Avatar' })}>
        <div className="relative w-fit">
          <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={avatarUrl} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} className="size-[88px]" size="xl" />
          {draft.avatarHash || draft.avatar ? <IconButton size="icon-xs" variant="secondary" disabled={busy} className="absolute -right-1 top-0" label={t({ ko: '아바타 지우기', en: 'Remove avatar' })} onClick={() => patch({ avatar: null, avatarHash: null, avatarCrop: null })}><X /></IconButton> : null}
        </div>
        <div className="flex items-center gap-1">
          <IconButton size="icon-sm" variant="secondary" disabled={busy || !referenceUrl || !draft.referenceHash} label={t({ ko: '기준 이미지에서 자르기', en: 'Crop reference image' })} onClick={() => setCropOpen(true)}><Crop /></IconButton>
          <ChatProfileAssetInput characterName={draft.name} extraInputs={false} onChange={(avatarHash) => patch({ avatarHash, avatarCrop: null, avatar: avatarHash === (profile?.avatarHash ?? draft.avatarHash) ? profile?.avatar ?? draft.avatar : null })} onBusyChange={onBusyChange} busy={busy} />
        </div>
      </EditorGroup>
      <EditorGroup label={t({ ko: '외형 설명', en: 'Appearance' })} actions={<IconButton size="icon-xs" variant="ghost" disabled={busy || appearance.isPending} label={t({ ko: '초안 쓰기', en: 'Draft appearance' })} onClick={() => void writeAppearance()}>{appearance.isPending ? <Spinner /> : <Sparkles />}</IconButton>}>
        <Textarea variant="settings" disabled={appearance.isPending} className="min-h-[120px]" rows={5} value={draft.appearance ?? ''} maxLength={20000} aria-label={t({ ko: '외형 설명', en: 'Appearance' })} onChange={(event) => patch({ appearance: event.target.value })} />
      </EditorGroup>
    </div>
    {cropOpen && referenceUrl ? <ChatProfileAvatarCrop src={referenceUrl} initial={draft.avatarHash === draft.referenceHash ? draft.avatarCrop : null} onClose={() => setCropOpen(false)} onApply={(avatarCrop) => { patch({ avatarHash: draft.referenceHash, avatarCrop, avatar: draft.referenceHash === (profile?.avatarHash ?? draft.avatarHash) ? profile?.avatar ?? draft.avatar : null }); setCropOpen(false) }} /> : null}
    <ChatProfileAssetGroups characterName={profile?.name ?? draft.name} busy={busy} onCreate={() => setAssetsMode('all')} />
    {assetsMode ? <ChatAssetBatchModal profile={{ id: profile?.id ?? 0, name: draft.name, referenceHash: draft.referenceHash }} initialBatchId={assetsMode === 'reference' ? null : batchId} referenceOnly={assetsMode === 'reference'} onBatchChange={onBatchChange} onPrepare={onPrepareAssets} onApplied={onAssetsApplied} onClose={() => setAssetsMode(null)} /> : null}
  </div>
}
