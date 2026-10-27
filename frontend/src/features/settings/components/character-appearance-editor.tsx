import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Crop, ImagePlus, Sparkles, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorGroup } from '@/components/ui/editor-group'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { useI18n } from '@/i18n'
import type { ChatAssetUploadTarget, ChatAvatarCrop } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatProfileCandidateArchive } from './chat-profile-asset-groups'
import { ChatProfileAssetInput } from './chat-profile-asset-input'
import { REFERENCE_SLOT, type AssetRuns } from './chat-profile-asset-runs'
import { AssetCandidateTray, ExpressionSlots, type CharacterGroupSource } from './chat-profile-asset-slots'
import { ChatProfileAvatarCrop } from './chat-profile-avatar-crop'

/** The look fields an appearance editor reads; a chat profile draft and a library setting draft both carry them. */
export type AppearanceValue = { name: string; appearance?: string; referenceHash?: string | null; avatarHash?: string | null; avatarCrop?: ChatAvatarCrop | null }

/**
 * Everything a character looks like, for any owner (a chat profile or a character library setting): the reference
 * image, the avatar cut from it, the appearance tags, the expression slots generated from them and the candidate
 * archive. The owner supplies its storage (upload target, group ids, expression writes) and its own extras.
 */
export function CharacterAppearanceEditor({ value, onChange, onAvatarChange, referenceUrl, avatar, hasAvatar, uploadTarget, groupSource, runs, busy, onBusyChange, draftAppearance, draftNeedsName = false, onSetExpression, onClearExpression, appearanceWarning = null, appearanceInvalid = false, editable = true, generation = true, expressionsEditable = true, expressionsNote = null, children }: {
  value: AppearanceValue
  onChange: (patch: { appearance?: string; referenceHash?: string | null }) => void
  /** A picked or cropped avatar; null clears it. */
  onAvatarChange: (avatarHash: string | null, avatarCrop: ChatAvatarCrop | null) => void
  referenceUrl: string | null
  /** The avatar preview (72px). */
  avatar: ReactNode
  hasAvatar: boolean
  /** Where uploads, URLs and stored files are imported to; null offers only the library pick. */
  uploadTarget: ChatAssetUploadTarget | (() => Promise<ChatAssetUploadTarget>) | null
  groupSource: CharacterGroupSource
  runs: AssetRuns
  busy: boolean
  onBusyChange: (busy: boolean) => void
  /** Writes an unsaved appearance draft (✨); left out hides it. */
  draftAppearance?: (signal: AbortSignal) => Promise<{ appearance: string }>
  /** The ✨ draft waits for a name. */
  draftNeedsName?: boolean
  onSetExpression: (name: string, hash: string) => Promise<void>
  onClearExpression: (name: string) => Promise<void>
  appearanceWarning?: string | null
  appearanceInvalid?: boolean
  /** False: everything only shows. */
  editable?: boolean
  /** Image generation and expression writes (administrators). */
  generation?: boolean
  /** Between the expressions and the candidate archive (a profile's emoticon groups). */
  /** False: the expression slots only show (they belong to a group the owner gets once saved). */
  expressionsEditable?: boolean
  /** Shown instead of the expression slots when there is no group to show (a library setting's, unreadable or empty). */
  expressionsNote?: string | null
  children?: ReactNode
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
    mutationFn: () => { controller.current = new AbortController(); reportBusy.current(true); return draftAppearance!(controller.current.signal) },
    onSuccess: (result) => { if (active.current) onChange({ appearance: result.appearance }) },
    onError: (error) => { if (active.current) showSnackbar({ message: getErrorMessage(error, t({ ko: '외형 초안을 쓰지 못했어.', en: 'Could not draft appearance.' })), tone: 'error' }) },
    onSettled: () => { if (controller.current) { controller.current = null; reportBusy.current(false) } },
  })
  const writeAppearance = async () => {
    if (value.appearance?.trim() && !await confirm({ title: t({ ko: '외형 설명 덮어쓰기', en: 'Replace appearance' }), description: t({ ko: '지금 설명을 새 초안으로 바꿀까?', en: 'Replace the current description with a new draft?' }), confirmLabel: t({ ko: '초안 쓰기', en: 'Draft' }) })) return
    if (active.current) appearance.mutate()
  }

  const mode = runs.preset?.assetSupport?.mode ?? null
  const reference = runs.slotState(REFERENCE_SLOT)
  const nameMissing = !value.name.trim()
  const presetBlocked = !runs.preset ? t({ ko: '자산을 만들 수 있는 생성 프리셋이 없어', en: 'No generation preset can make assets' }) : null
  const nameBlocked = nameMissing ? t({ ko: '이름을 먼저 적어줘', en: 'Enter a name first' }) : null
  const expressionBlocked = presetBlocked ?? nameBlocked ?? (mode === 'reference' && !value.referenceHash ? t({ ko: '기준 이미지를 먼저 정해줘', en: 'Set the reference image first' }) : null)
  const generating = editable && generation
  const draftBlocked = draftNeedsName ? nameBlocked : null
  // The library pick opens at a group given by id (a library setting's candidates); a profile's starts at its own folder.
  const libraryGroupId = 'candidateGroupId' in groupSource ? groupSource.candidateGroupId : null

  const setExpression = async (name: string, hash: string) => {
    try {
      await onSetExpression(name, hash)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '표정을 넣지 못했어.', en: 'Could not set the expression.' })), tone: 'error' })
    }
  }
  const clearExpression = async (name: string) => {
    try {
      await onClearExpression(name)
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
            {editable && value.referenceHash ? <IconButton size="icon-xs" variant="secondary" disabled={busy} className="absolute right-1.5 top-1.5" label={t({ ko: '기준 이미지 지우기', en: 'Remove reference image' })} onClick={() => onChange({ referenceHash: null })}><X /></IconButton> : null}
            {editable ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-0.5 bg-gradient-to-t from-black/75 to-transparent p-1.5 pt-6 text-white [&_button]:text-white">
                <ChatProfileAssetInput target={uploadTarget} libraryGroupId={libraryGroupId} onChange={(referenceHash) => onChange({ referenceHash })} onBusyChange={onBusyChange} busy={busy} />
                <span className="flex-1" />
                {generation ? <IconButton size="icon-sm" variant="ghost" disabled={busy || Boolean(presetBlocked ?? nameBlocked) || reference.working} label={presetBlocked ?? nameBlocked ?? t({ ko: '기준 이미지 만들기', en: 'Generate reference image' })} onClick={() => void runs.start({ kind: 'reference' }, !value.referenceHash)}><Sparkles /></IconButton> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-3">
            {avatar}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t({ ko: '아바타', en: 'Avatar' })}</span>
              {editable ? (
                <div className="flex items-center gap-0.5">
                  <IconButton size="icon-sm" variant="secondary" disabled={busy || !referenceUrl || !value.referenceHash} label={t({ ko: '기준 이미지에서 자르기', en: 'Crop reference image' })} onClick={() => setCropOpen(true)}><Crop /></IconButton>
                  <ChatProfileAssetInput target={uploadTarget} libraryGroupId={libraryGroupId} extraInputs={false} onChange={(avatarHash) => onAvatarChange(avatarHash, null)} onBusyChange={onBusyChange} busy={busy} />
                  {hasAvatar ? <IconButton size="icon-sm" variant="ghost" disabled={busy} label={t({ ko: '아바타 지우기', en: 'Remove avatar' })} onClick={() => onAvatarChange(null, null)}><X /></IconButton> : null}
                </div>
              ) : null}
            </div>
          </div>
          <EditorGroup
            label={<>{t({ ko: '외형 설명', en: 'Appearance' })}{appearanceWarning ? <Tip content={appearanceWarning}><span className="inline-flex normal-case tracking-normal text-warning" tabIndex={0} aria-label={appearanceWarning}><AlertTriangle className="size-3.5" /></span></Tip> : null}</>}
            actions={editable && draftAppearance ? <IconButton size="icon-xs" variant="ghost" disabled={busy || appearance.isPending || Boolean(draftBlocked)} label={draftBlocked ?? t({ ko: '기준 이미지나 프롬프트 보고 초안 쓰기', en: 'Draft from the reference image or prompt' })} onClick={() => void writeAppearance()}>{appearance.isPending ? <Spinner /> : <Sparkles />}</IconButton> : undefined}
          >
            <Textarea variant="settings" disabled={appearance.isPending} readOnly={!editable} className="min-h-[120px]" rows={5} value={value.appearance ?? ''} maxLength={CHAT_PROFILE_TEXT_LIMITS.text} aria-invalid={appearanceInvalid || undefined} aria-label={t({ ko: '외형 설명', en: 'Appearance' })} onChange={(event) => onChange({ appearance: event.target.value })} />
          </EditorGroup>
        </div>
      </div>

      {reference.working || reference.failed || reference.candidates.length ? (
        <AssetCandidateTray runs={runs} slotKey={REFERENCE_SLOT} title={t({ ko: '기준 이미지', en: 'Reference image' })} currentHash={value.referenceHash ?? null} referenceHash={null} />
      ) : null}

      <div className="border-t border-line pt-4">
        {expressionsNote ? <p className="text-sm text-muted-foreground">{expressionsNote}</p> : (
          <ExpressionSlots
            runs={runs}
            groupSource={groupSource}
            referenceHash={value.referenceHash ?? null}
            canGenerate={!expressionBlocked && !busy}
            blockedReason={expressionBlocked}
            onSet={setExpression}
            onClear={clearExpression}
            renderInput={(onPick) => <ChatProfileAssetInput target={uploadTarget} libraryGroupId={libraryGroupId} extraInputs={false} onChange={onPick} onBusyChange={onBusyChange} busy={busy} />}
            editable={generating && expressionsEditable}
          />
        )}
      </div>

      {children}
      <div className="border-t border-line">
        <ChatProfileCandidateArchive source={groupSource} generated={runs.candidateTotal} />
      </div>

      {cropOpen && referenceUrl ? <ChatProfileAvatarCrop src={referenceUrl} initial={value.avatarHash === value.referenceHash ? value.avatarCrop : null} onClose={() => setCropOpen(false)} onApply={(avatarCrop) => { onAvatarChange(value.referenceHash ?? null, avatarCrop); setCropOpen(false) }} /> : null}
    </div>
  )
}
