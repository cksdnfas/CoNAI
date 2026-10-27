import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { Check, UserRound, UserRoundPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
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
import { characterThumbnailUrl } from '@/features/characters/character-library-shared'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { loadCharacterReferenceDraft } from '../character-setting-load'
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
  /** The reference image, when the person chose to put it into `referenceTarget` (as chosen at confirm time). */
  reference: SelectedImageDraft | null
  referenceTarget: CharacterSettingLoadTarget | null
}

type CharacterSettingLoadButtonProps = {
  label: string
  /** `add`: the pick becomes a new entry (a new NAI character). */
  icon?: 'load' | 'add'
  /** A labelled button (section-level entry) instead of an icon key with a tooltip. */
  showLabel?: boolean
  size?: 'icon-xs' | 'icon-sm'
  tooltipSide?: ComponentProps<typeof IconButton>['tooltipSide']
  disabled?: boolean
  /** Where the tags can go; more than one is chosen at confirm time. Omitted: the caller's one place. */
  textTargets?: CharacterSettingLoadTarget[]
  /** Where the reference image can go; one is a switch (on by default), several a choice. Empty: tags only. */
  referenceTargets?: CharacterSettingLoadTarget[]
  onLoad: (load: CharacterSettingLoad) => void
}

type ConfirmStep = { setting: CharacterSetting; textTargetId: string | null; referenceTarget: CharacterSettingLoadTarget | null }

/**
 * "캐릭터 불러오기": pick a character library setting and copy its appearance tags (and, when chosen, its reference
 * image) into the form. Hidden without `characters.view`; the reference needs `images.view`. The values are copied
 * at that moment, so later library edits leave the form alone.
 */
export function CharacterSettingLoadButton({
  label,
  icon = 'load',
  showLabel = false,
  size = 'icon-sm',
  tooltipSide,
  disabled = false,
  textTargets,
  referenceTargets = [],
  onLoad,
}: CharacterSettingLoadButtonProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { has } = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [step, setStep] = useState<ConfirmStep | null>(null)
  const [loading, setLoading] = useState(false)
  const onLoadRef = useRef(onLoad)
  useEffect(() => {
    onLoadRef.current = onLoad
  })

  if (!has('characters.view')) return null

  const Icon = icon === 'add' ? UserRoundPlus : UserRound
  const referenceOptionsOf = (setting: CharacterSetting) => (canViewImages && setting.referenceHash ? referenceTargets : [])

  const finish = async ({ setting, textTargetId, referenceTarget }: ConfirmStep) => {
    const appearance = setting.appearance.trim()
    if (!appearance && !referenceTarget) {
      showSnackbar({ message: t({ ko: '이 외형 설정엔 넣을 외형 태그가 없어.', en: 'This setting has no appearance tags to insert.' }), tone: 'info' })
      setStep(null)
      return
    }
    setLoading(true)
    try {
      const reference = referenceTarget ? await loadCharacterReferenceDraft(setting) : null
      // The form may have changed while the image loaded: write through the latest render's handler.
      onLoadRef.current({ setting, appearance, textTargetId, reference, referenceTarget })
      setStep(null)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '레퍼런스 이미지를 불러오지 못했어.', en: 'Could not load the reference image.' })), tone: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handlePick = (setting: CharacterSetting) => {
    const referenceOptions = referenceOptionsOf(setting)
    const next = { setting, textTargetId: textTargets?.[0]?.id ?? null, referenceTarget: referenceOptions[0] ?? null }
    // Ask only when there is a choice to make: which field, or whether the reference goes in too.
    if ((textTargets?.length ?? 0) > 1 || referenceOptions.length > 0) setStep(next)
    else void finish(next)
  }

  const referenceOptions = step ? referenceOptionsOf(step.setting) : []
  // The chosen target among the current options; when its row disappeared, the choice resets to the first option.
  const chosenReference = step?.referenceTarget
    ? referenceOptions.find((option) => isSameTarget(option, step.referenceTarget as CharacterSettingLoadTarget)) ?? referenceOptions[0] ?? null
    : null
  const stepAppearance = step?.setting.appearance.trim() ?? ''

  return (
    <>
      {showLabel ? (
        <Button type="button" variant="ghost" size="compact" disabled={disabled} onClick={() => setPickerOpen(true)}>
          <Icon />
          {label}
        </Button>
      ) : (
        <IconButton size={size} variant="ghost" disabled={disabled} label={label} tooltipSide={tooltipSide} onClick={() => setPickerOpen(true)}>
          <Icon />
        </IconButton>
      )}
      <CharacterSettingPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={handlePick} title={label} />
      {step ? (
        <Modal open size="narrow" title={t({ ko: '‘{name}’ 불러오기', en: 'Load ‘{name}’' }, { name: step.setting.name })} onClose={() => { if (!loading) setStep(null) }}>
          <ModalBody spacing="sm">
            {step.setting.path.length > 0 ? <Text as="p" variant="caption" className="truncate">{step.setting.path.join(' / ')}</Text> : null}
            <Text as="p" variant="muted" className="line-clamp-4 break-words">
              {stepAppearance || t({ ko: '외형 태그가 비어 있어.', en: 'No appearance tags.' })}
            </Text>
            {textTargets && textTargets.length > 1 ? (
              <Field label={t({ ko: '태그를 넣을 칸', en: 'Insert the tags into' })}>
                <Select value={step.textTargetId ?? ''} disabled={loading} onChange={(event) => setStep({ ...step, textTargetId: event.target.value })}>
                  {textTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                </Select>
              </Field>
            ) : null}
            {step.setting.referenceHash && referenceOptions.length > 0 ? (
              <div className="flex items-center gap-3">
                <span className="size-16 shrink-0 overflow-hidden rounded-sm bg-muted">
                  {/* A hidden, blocked or deleted reference keeps the placeholder instead of a broken image. */}
                  <ChatProfileImage
                    src={characterThumbnailUrl(step.setting.referenceHash)}
                    fallback={<span className="flex size-full items-center justify-center text-muted-foreground"><UserRound className="size-6" /></span>}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  {referenceOptions.length === 1 ? (
                    <SwitchLine
                      label={t({ ko: '레퍼런스 이미지도 넣기 · {target}', en: 'Also set the reference image · {target}' }, { target: referenceOptions[0].label })}
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
                </div>
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <span className="flex-1" />
            <Button type="button" variant="ghost" disabled={loading} onClick={() => setStep(null)}>{t({ ko: '취소', en: 'Cancel' })}</Button>
            <Button type="button" disabled={loading} onClick={() => void finish({ ...step, referenceTarget: chosenReference })}>
              {loading ? <Spinner className="size-3" /> : <Check />}
              {t({ ko: '불러오기', en: 'Load' })}
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </>
  )
}
