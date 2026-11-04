import { useEffect, useId, useRef, useState, type ComponentProps } from 'react'
import { composeCharacterAppearance } from '@conai/shared'
import { Star, UserRound, UserRoundPlus } from 'lucide-react'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SwitchLine } from '@/components/ui/switch-line'
import { Text } from '@/components/ui/text'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { CharacterSettingPickerDialog } from '@/features/characters/components/character-setting-picker-dialog'
import { useI18n } from '@/i18n'
import type { CharacterSetting } from '@/lib/api-character-library'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { characterThumbnailUrl } from '@/features/characters/character-library-shared'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { characterSettingImages, loadCharacterImageDraft } from '../character-setting-load'
import type { SelectedImageDraft } from '../image-generation-shared'

export type CharacterSettingLoadTarget = {
  id: string
  label: string
  /**
   * What the target stands for when its `id` is only a position (a reference row): the choice follows this object,
   * so rows moving while the dialog is open or the image loads never redirect it to a neighbouring row.
   */
  identity?: object
}

const isSameTarget = (left: CharacterSettingLoadTarget, right: CharacterSettingLoadTarget) => (
  left.identity || right.identity ? left.identity === right.identity : left.id === right.id
)

/** What one pick copies into the form; the caller writes it with its ordinary setters. */
export type CharacterSettingLoad = {
  setting: CharacterSetting
  /** The setting's appearance tags, trimmed; empty when it has none. */
  appearance: string
  /** The chosen `textTargets` entry; null when the caller gave none (it has one place). */
  textTargetId: string | null
  /**
   * The setting's images the person chose (its reference image or gallery images), in order: the first goes into
   * `referenceTarget`, the rest (only with `referenceMultiple`) become new entries. Empty: tags only.
   */
  references: SelectedImageDraft[]
  referenceTarget: CharacterSettingLoadTarget | null
}

type CharacterSettingLoadButtonProps = {
  label: string
  /** `add`: the pick becomes a new entry (a new NAI character). */
  icon?: 'load' | 'add'
  size?: 'icon-xs' | 'icon-sm'
  tooltipSide?: ComponentProps<typeof IconButton>['tooltipSide']
  disabled?: boolean
  /** Where the tags can go; more than one is chosen at confirm time. Omitted: the caller's one place. */
  textTargets?: CharacterSettingLoadTarget[]
  /** Where the reference image can go; one is a switch (on by default), several a choice. Empty: tags only. */
  referenceTargets?: CharacterSettingLoadTarget[]
  /** The form takes several of the setting's images (the first into the chosen target, the rest as new entries). */
  referenceMultiple?: boolean
  onLoad: (load: CharacterSettingLoad) => void
}

/** `outfitIndex`: which outfit goes with the sections (0: the default); `imageHashes`: the chosen images in order. */
type ConfirmStep = { setting: CharacterSetting; textTargetId: string | null; referenceTarget: CharacterSettingLoadTarget | null; outfitIndex: number; imageHashes: string[] }
const appearanceOf = (setting: CharacterSetting, outfitIndex: number) => composeCharacterAppearance(setting, outfitIndex).trim()

/**
 * "캐릭터 불러오기": pick a character library setting and copy its appearance tags (and, when chosen, its reference
 * or gallery images) into the form. Hidden without `characters.view`; images need `images.view`. The values are
 * copied at that moment, so later library edits leave the form alone.
 */
export function CharacterSettingLoadButton({
  label,
  icon = 'load',
  size = 'icon-sm',
  tooltipSide,
  disabled = false,
  textTargets,
  referenceTargets = [],
  referenceMultiple = false,
  onLoad,
}: CharacterSettingLoadButtonProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { has } = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [step, setStep] = useState<ConfirmStep | null>(null)
  const [loading, setLoading] = useState(false)
  const imagesCaptionId = useId()
  const onLoadRef = useRef(onLoad)
  useEffect(() => {
    onLoadRef.current = onLoad
  })

  if (!has('characters.view')) return null

  const Icon = icon === 'add' ? UserRoundPlus : UserRound
  const imagesOf = (setting: CharacterSetting) => (canViewImages ? characterSettingImages(setting) : [])
  const referenceOptionsOf = (setting: CharacterSetting) => (imagesOf(setting).length ? referenceTargets : [])

  const finish = async ({ setting, textTargetId, referenceTarget, outfitIndex, imageHashes }: ConfirmStep) => {
    const appearance = appearanceOf(setting, outfitIndex)
    const hashes = referenceTarget ? imageHashes : []
    if (!appearance && !hashes.length) {
      showSnackbar({ message: t({ ko: '이 외형 설정엔 넣을 외형 태그가 없어.', en: 'This setting has no appearance tags to insert.' }), tone: 'info' })
      setStep(null)
      return
    }
    setLoading(true)
    try {
      const references = await Promise.all(hashes.map((hash) => loadCharacterImageDraft(setting.name, hash)))
      // The form may have changed while the images loaded: write through the latest render's handler.
      onLoadRef.current({ setting, appearance, textTargetId, references, referenceTarget: references.length ? referenceTarget : null })
      setStep(null)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '레퍼런스 이미지를 불러오지 못했어.', en: 'Could not load the reference image.' })), tone: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handlePick = (setting: CharacterSetting) => {
    const referenceOptions = referenceOptionsOf(setting)
    // The reference image goes in by default, as before the gallery; without one, the first gallery image.
    const firstImage = imagesOf(setting)[0]
    const next = { setting, textTargetId: textTargets?.[0]?.id ?? null, referenceTarget: referenceOptions[0] ?? null, outfitIndex: 0, imageHashes: firstImage ? [firstImage.hash] : [] }
    // Ask only when there is a choice to make: which field, which outfit, or whether the reference goes in too.
    if ((textTargets?.length ?? 0) > 1 || referenceOptions.length > 0 || setting.outfits.length > 1) setStep(next)
    else void finish(next)
  }

  const referenceOptions = step ? referenceOptionsOf(step.setting) : []
  // The chosen target among the current options; when its row disappeared, the choice resets to the first option.
  const chosenReference = step?.referenceTarget
    ? referenceOptions.find((option) => isSameTarget(option, step.referenceTarget as CharacterSettingLoadTarget)) ?? referenceOptions[0] ?? null
    : null
  const stepAppearance = step ? appearanceOf(step.setting, step.outfitIndex) : ''
  const stepImages = step ? imagesOf(step.setting) : []
  const toggleImage = (hash: string) => {
    if (!step) return
    const chosen = step.imageHashes.includes(hash)
    // Keep the gallery's order whatever order they were clicked in, so the first chosen image is predictable.
    const imageHashes = referenceMultiple
      ? stepImages.map((image) => image.hash).filter((candidate) => (candidate === hash ? !chosen : step.imageHashes.includes(candidate)))
      : chosen ? [] : [hash]
    setStep({ ...step, imageHashes })
  }

  return (
    <>
      <IconButton size={size} variant="ghost" disabled={disabled} label={label} tooltipSide={tooltipSide} onClick={() => setPickerOpen(true)}>
        <Icon />
      </IconButton>
      <CharacterSettingPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={handlePick} title={label} />
      {step ? (
        <Modal open size="md" title={t({ ko: '‘{name}’ 불러오기', en: 'Load ‘{name}’' }, { name: step.setting.name })} onClose={() => { if (!loading) setStep(null) }}>
          <ModalBody spacing="sm">
            {step.setting.path.length > 0 ? <Text as="p" variant="caption" className="truncate">{step.setting.path.join(' / ')}</Text> : null}
            <Text as="p" variant="muted" className="line-clamp-4 break-words">
              {stepAppearance || t({ ko: '외형 태그가 비어 있어.', en: 'No appearance tags.' })}
            </Text>
            {step.setting.outfits.length > 1 ? (
              <Field label={t({ ko: '의상', en: 'Outfit' })}>
                <Select value={String(step.outfitIndex)} disabled={loading} onChange={(event) => setStep({ ...step, outfitIndex: Number(event.target.value) })}>
                  {step.setting.outfits.map((outfit, index) => <option key={`${index}:${outfit.name}`} value={index}>{index === 0 ? t({ ko: '{name} (기본)', en: '{name} (default)' }, { name: outfit.name }) : outfit.name}</option>)}
                </Select>
              </Field>
            ) : null}
            {textTargets && textTargets.length > 1 ? (
              <Field label={t({ ko: '태그를 넣을 칸', en: 'Insert the tags into' })}>
                <Select value={step.textTargetId ?? ''} disabled={loading} onChange={(event) => setStep({ ...step, textTargetId: event.target.value })}>
                  {textTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                </Select>
              </Field>
            ) : null}
            {referenceOptions.length > 0 ? (
              <div className="space-y-2">
                {referenceOptions.length === 1 ? (
                  <SwitchLine
                    label={t({ ko: '레퍼런스 이미지도 넣기 · {target}', en: 'Also set reference images · {target}' }, { target: referenceOptions[0].label })}
                    checked={chosenReference !== null}
                    disabled={loading}
                    onCheckedChange={(checked) => setStep({ ...step, referenceTarget: checked ? referenceOptions[0] : null })}
                  />
                ) : (
                  <Field label={t({ ko: '레퍼런스 이미지를 넣을 칸', en: 'Set the reference image into' })}>
                    <Select value={chosenReference?.id ?? ''} disabled={loading} onChange={(event) => setStep({ ...step, referenceTarget: referenceOptions.find((option) => option.id === event.target.value) ?? null })}>
                      <option value="">{t({ ko: '넣지 않기', en: 'Do not set' })}</option>
                      {referenceOptions.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                    </Select>
                  </Field>
                )}
                {chosenReference ? (
                  <>
                    <Text as="p" variant="caption" id={imagesCaptionId}>
                      {referenceMultiple
                        ? t({ ko: '넣을 이미지를 골라. 첫 장은 위 칸에, 나머지는 새 참조로 들어가.', en: 'Choose the images: the first goes into the slot above, the rest become new references.' })
                        : t({ ko: '넣을 이미지 한 장을 골라.', en: 'Choose one image.' })}
                    </Text>
                    <div role="group" aria-labelledby={imagesCaptionId} className="flex flex-wrap gap-2">
                      {stepImages.map((image, index) => {
                        const chosen = step.imageHashes.includes(image.hash)
                        // Several images can share a category, so the position tells them apart.
                        const name = `${image.isReference ? t({ ko: '기준 이미지', en: 'Reference image' }) : image.category ?? t({ ko: '미분류', en: 'Uncategorized' })} ${index + 1}/${stepImages.length}`
                        return (
                          // eslint-disable-next-line no-restricted-syntax -- the thumbnail itself is the control
                          <button
                            key={image.hash}
                            type="button"
                            disabled={loading}
                            aria-pressed={chosen}
                            aria-label={name}
                            title={name}
                            onClick={() => toggleImage(image.hash)}
                            className={cn('relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-sm bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed', chosen ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'opacity-60 hover:opacity-100')}
                          >
                            {/* A hidden, blocked or deleted image keeps the placeholder instead of a broken image. */}
                            <ChatProfileImage
                              src={characterThumbnailUrl(image.hash)}
                              fallback={<span className="flex size-full items-center justify-center text-muted-foreground"><UserRound className="size-6" /></span>}
                            />
                            {image.isReference ? <span className="absolute top-0.5 left-0.5 rounded-sm bg-primary p-0.5 text-primary-foreground"><Star className="size-3 fill-current" /></span> : null}
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </ModalBody>
          <EditorFooter onSave={() => void finish({ ...step, referenceTarget: chosenReference })} saving={loading} saveLabel={t({ ko: '불러오기', en: 'Load' })} />
        </Modal>
      ) : null}
    </>
  )
}
