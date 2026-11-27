import { useEffect, useId, useRef, useState, type ComponentProps } from 'react'
import { Palette } from 'lucide-react'
import { ImageChoiceGrid } from '@/components/common/image-choice-grid'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SwitchLine } from '@/components/ui/switch-line'
import { Text } from '@/components/ui/text'
import { ArtStylePickerDialog } from '@/features/art-styles/components/art-style-picker-dialog'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import { artStyleThumbnailUrl, type ArtStyle } from '@/lib/api-art-styles'
import { getErrorMessage } from '@/lib/error-message'
import type { SelectedImageDraft } from '../image-generation-shared'
import type { CharacterSettingLoadTarget } from './character-setting-load-button'
import { loadArtStyleImageDraft } from './use-chat-art-style-insertion'

/** What one pick copies into the form; the caller appends it with its ordinary setters. */
export type ArtStyleLoad = {
  style: ArtStyle
  /** The style's positive prompt, trimmed; empty when it has none. */
  positive: string
  /** The style's negative prompt when it goes in (a target was chosen); otherwise empty. */
  negative: string
  /** The chosen `positiveTargets` entry; null when the caller gave none (it has one place). */
  positiveTargetId: string | null
  negativeTargetId: string | null
  /** The style's images the person chose, in order (none unless they turned images on). */
  references: SelectedImageDraft[]
  referenceTarget: CharacterSettingLoadTarget | null
}

type ArtStyleLoadButtonProps = {
  label?: string
  size?: 'icon-xs' | 'icon-sm'
  tooltipSide?: ComponentProps<typeof IconButton>['tooltipSide']
  disabled?: boolean
  /** Where the positive prompt can go; more than one is chosen at confirm time. Omitted: the caller's one place. */
  positiveTargets?: CharacterSettingLoadTarget[]
  /** Where the negative prompt can go. Empty: the form has none, so it is left out (with a notice). */
  negativeTargets?: CharacterSettingLoadTarget[]
  /** The negative target chosen at first; null starts at "do not set". Omitted: the first target. */
  defaultNegativeTargetId?: string | null
  /** Where the images can go; they stay out unless the person turns them on. Empty: prompts only. */
  referenceTargets?: CharacterSettingLoadTarget[]
  /** The form takes several images (the first into the chosen target, the rest as new entries). */
  referenceMultiple?: boolean
  onLoad: (load: ArtStyleLoad) => void
}

/** `imageIds`: the style's images chosen, in the style's order. */
type ConfirmStep = { style: ArtStyle; positiveTargetId: string | null; negativeTargetId: string | null; referenceTarget: CharacterSettingLoadTarget | null; imageIds: string[] }

/**
 * "스타일 불러오기": pick an art style and append its positive prompt (and negative, where the form has a place for it)
 * to the form. Its images (the style's own copies) go in only when the person turns them on. Hidden without
 * the read right. Values are copied at that moment: nothing links the form to the style afterwards.
 */
export function ArtStyleLoadButton({
  label,
  size = 'icon-sm',
  tooltipSide,
  disabled = false,
  positiveTargets,
  negativeTargets = [],
  defaultNegativeTargetId,
  referenceTargets = [],
  referenceMultiple = false,
  onLoad,
}: ArtStyleLoadButtonProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { canRead } = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [step, setStep] = useState<ConfirmStep | null>(null)
  const [loading, setLoading] = useState(false)
  const imagesCaptionId = useId()
  const onLoadRef = useRef(onLoad)
  useEffect(() => {
    onLoadRef.current = onLoad
  })

  if (!canRead) return null
  const buttonLabel = label ?? t({ ko: '스타일 불러오기', en: 'Load art style' })
  const imagesOf = (style: ArtStyle) => (canViewImages ? style.images : [])
  const referenceOptionsOf = (style: ArtStyle) => (imagesOf(style).length ? referenceTargets : [])

  const finish = async ({ style, positiveTargetId, negativeTargetId, referenceTarget, imageIds }: ConfirmStep) => {
    const positive = style.positive.trim()
    const storedNegative = style.negative.trim()
    const negative = negativeTargetId !== null ? storedNegative : ''
    const chosen = referenceTarget ? imageIds : []
    if (!positive && !negative && !chosen.length) {
      showSnackbar({ message: t({ ko: '이 스타일엔 넣을 프롬프트가 없어.', en: 'This style has no prompt to insert.' }), tone: 'info' })
      setStep(null)
      return
    }
    setLoading(true)
    try {
      const references = await Promise.all(chosen.map((id) => loadArtStyleImageDraft(style, { id })))
      // The form may have changed while the images loaded: write through the latest render's handler.
      onLoadRef.current({ style, positive, negative, positiveTargetId, negativeTargetId: negative ? negativeTargetId : null, references, referenceTarget: references.length ? referenceTarget : null })
      if (storedNegative && !negativeTargets.length) showSnackbar({ message: t({ ko: '이 입력엔 부정 프롬프트 칸이 없어서 부정은 빼고 넣었어.', en: 'This form has no negative prompt, so the negative was left out.' }), tone: 'info' })
      setStep(null)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '스타일 이미지를 불러오지 못했어.', en: 'Could not load the style images.' })), tone: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const initialNegative = defaultNegativeTargetId !== undefined ? defaultNegativeTargetId : negativeTargets[0]?.id ?? null
  const handlePick = (style: ArtStyle) => {
    const next: ConfirmStep = { style, positiveTargetId: positiveTargets?.[0]?.id ?? null, negativeTargetId: style.negative.trim() ? initialNegative : null, referenceTarget: null, imageIds: [] }
    // Ask only when there is a choice to make: which field gets which prompt, or whether images go in too.
    if ((positiveTargets?.length ?? 0) > 1 || (style.negative.trim() && negativeTargets.length > 0) || referenceOptionsOf(style).length > 0) setStep(next)
    else void finish(next)
  }

  const referenceOptions = step ? referenceOptionsOf(step.style) : []
  const chosenReference = step?.referenceTarget ? referenceOptions.find((option) => option.id === step.referenceTarget!.id) ?? null : null
  const stepImages = step ? imagesOf(step.style) : []
  const setReference = (target: CharacterSettingLoadTarget | null) => {
    if (!step) return
    // Turning images on starts from the cover; turning them off forgets the choice.
    setStep({ ...step, referenceTarget: target, imageIds: target ? (step.imageIds.length ? step.imageIds : stepImages.slice(0, 1).map((image) => image.id)) : [] })
  }
  const toggleImage = (id: string) => {
    if (!step) return
    const chosen = step.imageIds.includes(id)
    // Keep the style's order whatever order they were clicked in, so the first chosen image is predictable.
    const imageIds = referenceMultiple
      ? stepImages.map((image) => image.id).filter((candidate) => (candidate === id ? !chosen : step.imageIds.includes(candidate)))
      : chosen ? [] : [id]
    setStep({ ...step, imageIds })
  }
  const targetSelect = (fieldLabel: string, value: string | null, targets: CharacterSettingLoadTarget[], onChange: (id: string | null) => void, optional: boolean) => (
    <Field label={fieldLabel}>
      <Select value={value ?? ''} disabled={loading} onChange={(event) => onChange(event.target.value || null)}>
        {optional ? <option value="">{t({ ko: '넣지 않기', en: 'Do not set' })}</option> : null}
        {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
      </Select>
    </Field>
  )

  return (
    <>
      <IconButton size={size} variant="ghost" disabled={disabled} label={buttonLabel} tooltipSide={tooltipSide} onClick={() => setPickerOpen(true)}>
        <Palette />
      </IconButton>
      <ArtStylePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={handlePick} title={buttonLabel} />
      {step ? (
        <Modal open size="md" title={t({ ko: '‘{name}’ 불러오기', en: 'Load ‘{name}’' }, { name: step.style.title })} onClose={() => { if (!loading) setStep(null) }}>
          <ModalBody spacing="sm">
            <Text as="p" variant="muted" className="line-clamp-4 break-words">
              {step.style.positive.trim() || t({ ko: '긍정 프롬프트가 비어 있어.', en: 'No positive prompt.' })}
            </Text>
            {positiveTargets && positiveTargets.length > 1 ? targetSelect(t({ ko: '긍정 프롬프트를 넣을 칸', en: 'Insert the positive prompt into' }), step.positiveTargetId, positiveTargets, (id) => setStep({ ...step, positiveTargetId: id ?? positiveTargets[0].id }), false) : null}
            {step.style.negative.trim() && negativeTargets.length > 0 ? (
              <>
                <Text as="p" variant="caption" className="line-clamp-2 break-words">{step.style.negative.trim()}</Text>
                {negativeTargets.length === 1 ? (
                  <SwitchLine
                    label={t({ ko: '부정 프롬프트도 넣기 · {target}', en: 'Also insert the negative prompt · {target}' }, { target: negativeTargets[0].label })}
                    checked={step.negativeTargetId !== null}
                    disabled={loading}
                    onCheckedChange={(checked) => setStep({ ...step, negativeTargetId: checked ? negativeTargets[0].id : null })}
                  />
                ) : targetSelect(t({ ko: '부정 프롬프트를 넣을 칸', en: 'Insert the negative prompt into' }), step.negativeTargetId, negativeTargets, (id) => setStep({ ...step, negativeTargetId: id }), true)}
              </>
            ) : null}
            {referenceOptions.length > 0 ? (
              <div className="space-y-2">
                {referenceOptions.length === 1 ? (
                  <SwitchLine
                    label={t({ ko: '스타일 이미지도 넣기 · {target}', en: 'Also set style images · {target}' }, { target: referenceOptions[0].label })}
                    checked={chosenReference !== null}
                    disabled={loading}
                    onCheckedChange={(checked) => setReference(checked ? referenceOptions[0] : null)}
                  />
                ) : targetSelect(t({ ko: '스타일 이미지를 넣을 칸', en: 'Set the style images into' }), chosenReference?.id ?? null, referenceOptions, (id) => setReference(referenceOptions.find((option) => option.id === id) ?? null), true)}
                {chosenReference ? (
                  <>
                    <Text as="span" variant="label" id={imagesCaptionId}>
                      {referenceMultiple ? t({ ko: '넣을 이미지 (첫 장은 위 칸, 나머지는 새 참조)', en: 'Images (the first into the slot above, the rest as new references)' }) : t({ ko: '넣을 이미지 한 장', en: 'One image' })}
                    </Text>
                    <ImageChoiceGrid
                      labelledBy={imagesCaptionId}
                      disabled={loading}
                      chosen={step.imageIds}
                      onToggle={toggleImage}
                      images={stepImages.map((image, index) => ({ key: image.id, src: artStyleThumbnailUrl(step.style.id, image.id), marked: index === 0, label: `${index === 0 ? t({ ko: '대표', en: 'Cover' }) : t({ ko: '이미지', en: 'Image' })} ${index + 1}/${stepImages.length}` }))}
                    />
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
