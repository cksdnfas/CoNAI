import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Crop, ImagePlus, Sparkles, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { useI18n } from '@/i18n'
import { clearChatProfileExpression, draftChatAppearance, setChatProfileExpression, type ChatProfile } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatProfileCandidateArchive } from './chat-profile-asset-groups'
import { ChatProfileAssetInput } from './chat-profile-asset-input'
import { REFERENCE_SLOT, type ProfileAssetRuns } from './chat-profile-asset-runs'
import { AssetCandidateTray, ExpressionSlots } from './chat-profile-asset-slots'
import { ChatProfileAvatarCrop } from './chat-profile-avatar-crop'
import { EditorGroup, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { ChatEmoticonGroupPicker } from './chat-profile-emoticons'
import { draftProfileAssetUrl } from './chat-profile-images'

/**
 * Everything the character looks like: the reference image, the avatar cut from it, the appearance text, and the
 * expression slots generated from them (the character's emoticons), plus other emoticon groups its chats may use.
 */
export function ChatProfileAppearancePanel({ draft, patch, profile, onBusyChange, busy, runs, ensureProfile, onProfileChange }: {
  draft: Draft
  patch: PatchDraft
  profile: ChatProfile | null
  onBusyChange: (busy: boolean) => void
  busy: boolean
  runs: ProfileAssetRuns
  /** Saves name, appearance and reference (creating a new profile) before anything is generated or linked. */
  ensureProfile: () => Promise<ChatProfile>
  onProfileChange: (profile: ChatProfile) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const [cropOpen, setCropOpen] = useState(false)
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
  const characterName = profile?.name ?? draft.name
  const mode = runs.preset?.assetSupport?.mode ?? null
  const reference = runs.slotState(REFERENCE_SLOT)
  const nameMissing = !draft.name.trim()
  const presetBlocked = !runs.preset ? t({ ko: '자산을 만들 수 있는 생성 프리셋이 없어', en: 'No generation preset can make assets' }) : null
  const nameBlocked = nameMissing ? t({ ko: '이름을 먼저 적어줘', en: 'Enter a name first' }) : null
  const expressionBlocked = presetBlocked ?? nameBlocked ?? (mode === 'reference' && !draft.referenceHash ? t({ ko: '기준 이미지를 먼저 정해줘', en: 'Set the reference image first' }) : null)

  const setExpression = async (name: string, hash: string) => {
    try {
      const current = await ensureProfile()
      const result = await setChatProfileExpression(current.id, name, hash)
      onProfileChange(result.profile)
      patch({ style: { ...draft.style, emoticonGroupIds: [result.expressionGroupId, ...draft.style.emoticonGroupIds.filter((id) => id !== result.expressionGroupId)] } })
      await runs.refreshAfterApply()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '표정을 넣지 못했어.', en: 'Could not set the expression.' })), tone: 'error' })
    }
  }
  const clearExpression = async (name: string) => {
    if (!profile) return
    try {
      await clearChatProfileExpression(profile.id, name)
      await runs.refreshAfterApply()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '표정을 비우지 못했어.', en: 'Could not clear the expression.' })), tone: 'error' })
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <div className="relative aspect-[3/4] w-[200px] max-w-full overflow-hidden rounded-lg bg-fill">
            <ChatProfileImage src={referenceUrl} fallback={<span className="flex size-full items-center justify-center pb-10 text-muted-foreground"><ImagePlus className="size-6" /></span>} />
            {reference.working || runs.isPending(REFERENCE_SLOT) ? <span className="absolute inset-0 flex items-center justify-center bg-background/50"><Spinner /></span> : null}
            {draft.referenceHash ? <IconButton size="icon-xs" variant="secondary" disabled={busy} className="absolute right-1.5 top-1.5" label={t({ ko: '기준 이미지 지우기', en: 'Remove reference image' })} onClick={() => patch({ referenceHash: null })}><X /></IconButton> : null}
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-0.5 bg-gradient-to-t from-black/75 to-transparent p-1.5 pt-6 text-white [&_button]:text-white">
              <ChatProfileAssetInput characterName={characterName} onChange={(referenceHash) => patch({ referenceHash })} onBusyChange={onBusyChange} busy={busy} />
              <span className="flex-1" />
              <IconButton size="icon-sm" variant="ghost" disabled={busy || Boolean(presetBlocked ?? nameBlocked) || reference.working} label={presetBlocked ?? nameBlocked ?? t({ ko: '기준 이미지 만들기', en: 'Generate reference image' })} onClick={() => void runs.start({ kind: 'reference' }, !draft.referenceHash)}><Sparkles /></IconButton>
            </div>
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-3">
            <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={avatarUrl} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} className="size-[72px]" size="xl" />
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t({ ko: '아바타', en: 'Avatar' })}</span>
              <div className="flex items-center gap-0.5">
                <IconButton size="icon-sm" variant="secondary" disabled={busy || !referenceUrl || !draft.referenceHash} label={t({ ko: '기준 이미지에서 자르기', en: 'Crop reference image' })} onClick={() => setCropOpen(true)}><Crop /></IconButton>
                <ChatProfileAssetInput characterName={characterName} extraInputs={false} onChange={(avatarHash) => patch({ avatarHash, avatarCrop: null, avatar: avatarHash === (profile?.avatarHash ?? draft.avatarHash) ? profile?.avatar ?? draft.avatar : null })} onBusyChange={onBusyChange} busy={busy} />
                {draft.avatarHash || draft.avatar ? <IconButton size="icon-sm" variant="ghost" disabled={busy} label={t({ ko: '아바타 지우기', en: 'Remove avatar' })} onClick={() => patch({ avatar: null, avatarHash: null, avatarCrop: null })}><X /></IconButton> : null}
              </div>
            </div>
          </div>
          <EditorGroup label={t({ ko: '외형 설명', en: 'Appearance' })} actions={<IconButton size="icon-xs" variant="ghost" disabled={busy || appearance.isPending} label={t({ ko: '기준 이미지 보고 초안 쓰기', en: 'Draft from the reference image' })} onClick={() => void writeAppearance()}>{appearance.isPending ? <Spinner /> : <Sparkles />}</IconButton>}>
            <Textarea variant="settings" disabled={appearance.isPending} className="min-h-[120px]" rows={5} value={draft.appearance ?? ''} maxLength={20000} aria-label={t({ ko: '외형 설명', en: 'Appearance' })} onChange={(event) => patch({ appearance: event.target.value })} />
          </EditorGroup>
        </div>
      </div>

      {reference.working || reference.failed || reference.candidates.length ? (
        <AssetCandidateTray runs={runs} slotKey={REFERENCE_SLOT} title={t({ ko: '기준 이미지', en: 'Reference image' })} currentHash={draft.referenceHash ?? null} referenceHash={null} profileId={profile?.id ?? null} />
      ) : null}

      <div className="border-t border-line pt-4">
        <ExpressionSlots
          runs={runs}
          characterName={characterName}
          profileId={profile?.id ?? null}
          referenceHash={draft.referenceHash ?? null}
          canGenerate={!expressionBlocked && !busy}
          blockedReason={expressionBlocked}
          onSet={setExpression}
          onClear={clearExpression}
          renderInput={(onPick) => <ChatProfileAssetInput characterName={characterName} extraInputs={false} onChange={onPick} onBusyChange={onBusyChange} busy={busy} />}
        />
      </div>

      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
        <span className="shrink-0 text-sm">{t({ ko: '이모티콘 그룹', en: 'Emoticon groups' })}</span>
        <div className="min-w-0 flex-1"><ChatEmoticonGroupPicker selected={draft.style.emoticonGroupIds} onChange={(emoticonGroupIds) => patch({ style: { ...draft.style, emoticonGroupIds } })} /></div>
      </div>
      <div className="border-t border-line">
        <ChatProfileCandidateArchive characterName={characterName} />
      </div>

      {cropOpen && referenceUrl ? <ChatProfileAvatarCrop src={referenceUrl} initial={draft.avatarHash === draft.referenceHash ? draft.avatarCrop : null} onClose={() => setCropOpen(false)} onApply={(avatarCrop) => { patch({ avatarHash: draft.referenceHash, avatarCrop, avatar: draft.referenceHash === (profile?.avatarHash ?? draft.avatarHash) ? profile?.avatar ?? draft.avatar : null }); setCropOpen(false) }} /> : null}
    </div>
  )
}
