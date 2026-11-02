import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'
import { useMutation } from '@tanstack/react-query'
import { Crop, ImagePlus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorGroup } from '@/components/ui/editor-group'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { useI18n } from '@/i18n'
import type { ChatAssetUploadTarget, ChatAvatarCrop } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { uploadChatProfileAsset } from '@/lib/api-codex-chat'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ChatProfileCandidateArchive } from './chat-profile-asset-groups'
import { ChatProfileAssetInput } from './chat-profile-asset-input'
import { REFERENCE_SLOT, type AssetRuns } from './chat-profile-asset-runs'
import { AssetCandidateTray, ExpressionSlots, type CharacterGroupSource } from './chat-profile-asset-slots'
import { ChatProfileAvatarCrop } from './chat-profile-avatar-crop'

/** The look fields an appearance editor reads; a chat profile draft and a library setting draft both carry them. */
export type AppearanceValue = { name: string; appearance?: string; referenceHash?: string | null; avatarHash?: string | null; avatarCrop?: ChatAvatarCrop | null }
export type CharacterAppearanceTab = 'tags' | 'images' | 'expressions' | 'candidates'

/**
 * Everything a character looks like, for any owner (a chat profile or a character library setting), in two columns:
 * the images on the left (the reference image and the avatar cut from it), the words and what
 * is made from them on the right (the appearance tags, the expression slots, the owner's extras, the candidate
 * archive). Every image changes through the same "이미지 바꾸기" menu. The owner supplies its storage (upload target,
 * group ids, expression writes).
 */
export function CharacterAppearanceEditor({ value, onChange, onAvatarChange, referenceUrl, avatar, hasAvatar, uploadTarget, groupSource, runs, busy, onBusyChange, draftAppearance, draftNeedsName = false, onSetExpression, onClearExpression, appearanceWarning = null, appearanceInvalid = false, appearanceNote = null, appearanceEditor, editable = true, generation = true, expressionsEditable = true, expressionsNote = null, tab, tabs, gallery, children }: {
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
  /** A quiet line under the appearance text (who else a change reaches). */
  appearanceNote?: ReactNode
  /** Replaces the single appearance text (a library setting's sections and outfits); its owner shows warnings and notes. */
  appearanceEditor?: ReactNode
  /** False: everything only shows. */
  editable?: boolean
  /** Image generation and expression writes (administrators). */
  generation?: boolean
  /** Between the expressions and the candidate archive (a profile's emoticon groups). */
  /** False: the expression slots only show (they belong to a group the owner gets once saved). */
  expressionsEditable?: boolean
  /** Shown instead of the expression slots when there is no group to show (a library setting's, unreadable or empty). */
  expressionsNote?: string | null
  /** Shows one tab's content beside the reference and avatar column instead of the whole two-column editor. */
  tab?: CharacterAppearanceTab
  /** The tab strip over the tab content (with `tab`). */
  tabs?: ReactNode
  gallery?: ReactNode
  children?: ReactNode
}) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const imagesEditable = editable && canViewImages
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const [cropOpen, setCropOpen] = useState(false)
  const referenceUpload = useRef<HTMLInputElement>(null)
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
  // Only an image-input ComfyUI workflow needs the reference; NAI draws from the appearance text when there is none.
  const expressionBlocked = presetBlocked ?? nameBlocked ?? (mode === 'reference' && runs.preset?.kind === 'comfyui' && !value.referenceHash ? t({ ko: '기준 이미지를 먼저 정해줘', en: 'Set the reference image first' }) : null)
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
  const dropExpression = async (name: string, file: File) => {
    if (!uploadTarget || !imagesEditable || !generation || !expressionsEditable || busy) return
    reportBusy.current(true)
    try {
      const target = typeof uploadTarget === 'function' ? await uploadTarget() : uploadTarget
      const result = await uploadChatProfileAsset(file, target)
      if (active.current) await setExpression(name, result.compositeHash)
    } catch (error) {
      if (active.current) showSnackbar({ message: getErrorMessage(error, t({ ko: '이미지를 가져오지 못했어.', en: 'Could not import the image.' })), tone: 'error' })
    } finally { reportBusy.current(false) }
  }

  const referenceWorking = reference.working || runs.isPending(REFERENCE_SLOT)
  const generateBlocked = presetBlocked ?? nameBlocked ?? (referenceWorking ? t({ ko: '만드는 중이야', en: 'Generating' }) : null)
  const referenceSpinner = referenceWorking ? <span className="absolute inset-0 flex items-center justify-center bg-background/50"><Spinner /></span> : null
  const avatarInput = (label: string, size?: 'compact') => (
    <ChatProfileAssetInput
      target={uploadTarget}
      libraryGroupId={libraryGroupId}
      onChange={(avatarHash) => onAvatarChange(avatarHash, null)}
      onBusyChange={onBusyChange}
      busy={busy}
      label={label}
      variant="ghost"
      size={size}
      onClear={hasAvatar ? () => onAvatarChange(null, null) : undefined}
      clearLabel={t({ ko: '아바타 지우기', en: 'Remove avatar' })}
    />
  )
  const appearanceBlock = appearanceEditor ?? <EditorGroup
          label={t({ ko: '외형 설명', en: 'Appearance' })}
          actions={editable && draftAppearance ? (
            <Tip content={draftBlocked}>
              <span className="inline-flex" tabIndex={draftBlocked ? 0 : -1}>
                <IconButton size="icon-sm" variant="ghost" label={t({ ko: 'AI 초안', en: 'AI draft' })} disabled={busy || appearance.isPending || Boolean(draftBlocked)} onClick={() => void writeAppearance()}>
                  {appearance.isPending ? <Spinner className="size-3.5" /> : <Sparkles />}
                </IconButton>
              </span>
            </Tip>
          ) : undefined}
        >
          <Textarea variant="settings" disabled={appearance.isPending} readOnly={!editable} className="min-h-[120px]" rows={5} value={value.appearance ?? ''} maxLength={CHAT_PROFILE_TEXT_LIMITS.text} aria-invalid={appearanceInvalid || undefined} aria-label={t({ ko: '외형 설명', en: 'Appearance' })} onChange={(event) => onChange({ appearance: event.target.value })} />
          {appearanceWarning ? <p role="note" className="text-xs text-warning">{appearanceWarning}</p> : null}
          {appearanceNote ? <p className="text-xs text-muted-foreground">{appearanceNote}</p> : null}
        </EditorGroup>
  const referenceTray = reference.working || reference.failed || reference.candidates.length
    ? <AssetCandidateTray runs={runs} slotKey={REFERENCE_SLOT} title={t({ ko: '기준 이미지 후보', en: 'Reference candidates' })} currentHash={value.referenceHash ?? null} referenceHash={null} />
    : null
  const expressionsBlock = expressionsNote ? <p className="text-sm text-muted-foreground">{expressionsNote}</p> : (
            <ExpressionSlots
              runs={runs}
              groupSource={groupSource}
              referenceHash={value.referenceHash ?? null}
              canGenerate={!expressionBlocked && !busy}
              blockedReason={expressionBlocked}
              onSet={setExpression}
              onClear={clearExpression}
              renderInput={(slot) => (
                <ChatProfileAssetInput
                  target={uploadTarget}
                  libraryGroupId={libraryGroupId}
                  onChange={slot.onPick}
                  onBusyChange={onBusyChange}
                  busy={busy || slot.busy}
                  size="compact"
                  label={slot.empty ? t({ ko: '올리기', en: 'Upload' }) : undefined}
                  ariaLabel={slot.empty ? t({ ko: '{name} 올리기', en: 'Upload {name}' }, { name: slot.name }) : undefined}
                  variant={slot.empty ? 'ghost' : 'secondary'}
                  onGenerate={slot.onGenerate}
                  generateLabel={t({ ko: '다시 만들기', en: 'Generate again' })}
                  generateBlocked={slot.generateBlocked}
                  onClear={slot.onClear}
                  clearLabel={t({ ko: '비우기', en: 'Clear' })}
                />
              )}
              editable={imagesEditable && generation && expressionsEditable}
              generation={generation}
              onDropFile={uploadTarget ? dropExpression : undefined}
              onBusyChange={onBusyChange}
            />
          )
  const candidatesBlock = <ChatProfileCandidateArchive source={groupSource} generated={runs.candidateTotal} expanded={tab === 'candidates'} />
  const cropDialog = cropOpen && referenceUrl ? <ChatProfileAvatarCrop src={referenceUrl} initial={value.avatarHash === value.referenceHash ? value.avatarCrop : null} onClose={() => setCropOpen(false)} onApply={(avatarCrop) => { onAvatarChange(value.referenceHash ?? null, avatarCrop); setCropOpen(false) }} /> : null

  // Tabbed (the library's setting dialog): the reference and avatar stay in a column beside whichever tab is open.
  if (tab) {
    return (
      <div className="grid min-w-0 gap-x-6 gap-y-5 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4 md:sticky md:top-0 md:self-start">
          <div className="flex items-start gap-4 md:block md:space-y-2.5">
            <div className="relative aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-lg bg-fill md:w-full">
              <ChatProfileImage src={referenceUrl} fallback={<span className="flex size-full items-center justify-center text-muted-foreground"><ImagePlus className="size-6" /></span>} />
              {referenceSpinner}
            </div>
            {imagesEditable ? (
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                {uploadTarget ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => referenceUpload.current?.click()}>{t({ ko: '올리기', en: 'Upload' })}</Button> : null}
                <ChatProfileAssetInput
                  target={uploadTarget}
                  libraryGroupId={libraryGroupId}
                  onChange={(referenceHash) => onChange({ referenceHash })}
                  onBusyChange={onBusyChange}
                  busy={busy}
                  uploadRef={referenceUpload}
                  uploadEntry={false}
                  label={t({ ko: '가져오기', en: 'Import' })}
                />
                {generation ? (
                  <Tip content={generateBlocked}>
                    <span className="grid" tabIndex={generateBlocked ? 0 : -1}>
                      <Button size="sm" variant="secondary" disabled={busy || Boolean(generateBlocked)} onClick={() => void runs.start({ kind: 'reference' }, !value.referenceHash)}>{t({ ko: '새로 생성', en: 'Generate' })}</Button>
                    </span>
                  </Tip>
                ) : null}
                <Button size="sm" variant="ghost" disabled={busy || !value.referenceHash} onClick={() => onChange({ referenceHash: null })}>{t({ ko: '비우기', en: 'Clear' })}</Button>
              </div>
            ) : null}
          </div>
          {referenceTray}
          <div className="flex items-center gap-3 border-t border-line pt-4">
            {avatar}
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-semibold">{t({ ko: '아바타', en: 'Avatar' })}</p>
              {imagesEditable ? (
                <div className="flex flex-wrap gap-1.5">
                  {referenceUrl && value.referenceHash ? <Button size="compact" variant="secondary" disabled={busy} onClick={() => setCropOpen(true)}>{t({ ko: '자르기', en: 'Crop' })}</Button> : null}
                  {avatarInput(t({ ko: '바꾸기', en: 'Change' }), 'compact')}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="min-w-0">
          {tabs ? <div className="sticky top-0 z-sticky bg-surface-low">{tabs}</div> : null}
          <div className="space-y-6 pt-4">
            {tab === 'tags' ? appearanceBlock : tab === 'images' ? gallery : tab === 'expressions' ? expressionsBlock : candidatesBlock}
          </div>
        </div>
        {cropDialog}
      </div>
    )
  }

  return (
    <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <div className="relative aspect-[3/4] w-full max-w-60 overflow-hidden rounded-lg bg-fill">
          <ChatProfileImage src={referenceUrl} fallback={<span className="flex size-full items-center justify-center pb-10 text-muted-foreground"><ImagePlus className="size-6" /></span>} />
          {referenceSpinner}
          {imagesEditable ? (
            <div className="absolute right-2 bottom-2">
              <ChatProfileAssetInput
                target={uploadTarget}
                libraryGroupId={libraryGroupId}
                onChange={(referenceHash) => onChange({ referenceHash })}
                onBusyChange={onBusyChange}
                busy={busy}
                variant="overlay"
                size="compact"
                onGenerate={generation ? () => void runs.start({ kind: 'reference' }, !value.referenceHash) : undefined}
                generateLabel={t({ ko: '기준 이미지 새로 생성', en: 'Generate a reference image' })}
                generateBlocked={generateBlocked}
                onClear={value.referenceHash ? () => onChange({ referenceHash: null }) : undefined}
              />
            </div>
          ) : null}
        </div>
        <EditorGroup label={t({ ko: '기준 이미지 · 아바타', en: 'Reference image · avatar' })}>
          {/* The 15rem column is narrower than avatar + crop key, so the keys wrap below the avatar there. */}
          <div className="flex flex-wrap items-center gap-3">
            {avatar}
            {imagesEditable ? (
              <div className="flex min-w-0 flex-col items-start gap-1">
                {referenceUrl && value.referenceHash ? <IconButton size="icon-sm" variant="secondary" label={t({ ko: '기준 이미지에서 자르기', en: 'Crop the reference' })} disabled={busy} onClick={() => setCropOpen(true)}><Crop /></IconButton> : null}
                {avatarInput(t({ ko: '아바타 바꾸기', en: 'Change avatar' }))}
              </div>
            ) : null}
          </div>
        </EditorGroup>
      </div>

      <div className="min-w-0 space-y-6">
        {appearanceBlock}
        {referenceTray}
        <div className="border-t border-line pt-4">{expressionsBlock}</div>
        {children}
        <div className="border-t border-line">{candidatesBlock}</div>
      </div>
      {gallery ? <div className="min-w-0 lg:col-span-2">{gallery}</div> : null}
      {cropDialog}
    </div>
  )
}
