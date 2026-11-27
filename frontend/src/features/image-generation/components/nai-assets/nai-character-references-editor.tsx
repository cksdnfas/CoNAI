import { useState, type ReactNode } from 'react'
import { ImageIcon, ImagePlus, Plus, Save, Trash2 } from 'lucide-react'
import { isNaiV5Model } from '@conai/shared'
import { OverlayCard } from '@/components/common/overlay-card'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Panel } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { SwitchLine } from '@/components/ui/switch-line'
import { Tip } from '@/components/ui/tooltip'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import type { StoredNaiCharacterReferenceAsset } from '@/lib/api-image-generation-types'
import type { NAICharacterReferenceDraft, NaiCharacterReferencePatch, SelectedImageDraft } from '../../image-generation-shared'
import { ImageAttachmentPickerButton } from '../image-attachment-picker'
import { NaiSavedAssetBrowser, type NaiSavedAssetBrowserProps } from './nai-saved-asset-browser'

/** Saved-reference library wiring: the caller owns fetching/filtering, so each surface keeps its own query + search rules. */
export type NaiCharacterReferenceLibraryProps = Omit<NaiSavedAssetBrowserProps, 'items' | 'onSelect' | 'emptyMessage'> & {
  assets: StoredNaiCharacterReferenceAsset[]
  emptyMessage?: string
  onSelect: (asset: StoredNaiCharacterReferenceAsset) => void
}

type NaiCharacterReferencesEditorProps = {
  references: NAICharacterReferenceDraft[]
  /** False disables adding rows; the add button's tooltip says it's not available for this model. */
  supportsCharacterReference?: boolean
  model?: string
  defaultOpen?: boolean
  description?: ReactNode
  /** Append one new reference row from a picked image. */
  onAddImage: (image: SelectedImageDraft) => void
  onRemove: (index: number) => void
  onImageChange: (index: number, image?: SelectedImageDraft) => void
  onFieldChange: (index: number, patch: NaiCharacterReferencePatch) => void
  /** Per-row "save to library" action; omit to hide it. */
  onSave?: (index: number) => void
  library: NaiCharacterReferenceLibraryProps
}

type PickerState = { mode: 'add' } | { mode: 'replace'; index: number } | null

/** Shared image grid and per-image reference settings for the NAI generation form and module graph. */
export function NaiCharacterReferencesEditor({
  references,
  supportsCharacterReference = true,
  model,
  defaultOpen = false,
  description,
  onAddImage,
  onRemove,
  onImageChange,
  onFieldChange,
  onSave,
  library,
}: NaiCharacterReferencesEditorProps) {
  const { t } = useI18n()
  const { canEdit } = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const v5 = isNaiV5Model(model)
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [picker, setPicker] = useState<PickerState>(null)
  const { assets, emptyMessage, onSelect, ...browserProps } = library
  const addLabel = t('image-generation.components.nai.references.section.add.reference')
  const strengthLabel = t({ ko: '강도', en: 'Strength' })
  const fidelityLabel = t({ ko: '충실도', en: 'Fidelity' })
  const replaceLabel = t({ ko: '이미지 교체', en: 'Replace image' })

  return (
    <Section
      variant="settings"
      heading={v5 ? t({ ko: '정밀 참조', en: 'Precise Reference' }) : t({ ko: '레퍼런스', en: 'References' })}
      description={description}
      collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      actions={(
        <>
          <span className="px-1 text-xs tabular-nums text-muted-foreground">{references.length}</span>
          {supportsCharacterReference ? !isOpen && (
            <IconButton
              size="icon-sm"
              variant="ghost"
              onClick={() => setPicker({ mode: 'add' })}
              label={addLabel}
            >
              <Plus />
            </IconButton>
          ) : (
            // A disabled button swallows hover, so the span carries the "why" tooltip.
            <Tip content={v5
              ? t({ ko: 'V5 인페인트에서는 정밀 참조를 쓸 수 없어.', en: 'Precise Reference is unavailable with V5 inpainting.' })
              : t({ ko: '이 모델은 정밀 참조를 지원하지 않아.', en: 'This model does not support Precise Reference.' })}>
              <span className="inline-flex" tabIndex={0}>
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  disabled
                  tooltip={false}
                  label={addLabel}
                >
                  <Plus />
                </IconButton>
              </span>
            </Tip>
          )}
          <ImageAttachmentPickerButton
            hideTrigger
            label={addLabel}
            modalTitle={picker?.mode === 'replace'
              ? t('image-generation.components.nai.references.section.select.reference.image.with.index', { index: picker.index + 1 })
              : addLabel}
            allowSaveDialog={false}
            open={picker !== null}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) {
                setPicker(null)
              }
            }}
            librarySource={picker?.mode === 'add' ? {
              label: t({ ko: '저장됨', en: 'Saved' }),
              content: (
                <NaiSavedAssetBrowser
                  {...browserProps}
                  items={assets.map((asset) => ({
                    id: asset.id,
                    title: asset.label,
                    subtitle: asset.description?.trim() || asset.type,
                    imageUrl: asset.thumbnail_url || asset.image_url || asset.image_data_url,
                  }))}
                  emptyMessage={emptyMessage ?? t('image-generation.components.nai.references.section.no.search.results.or.saved.references')}
                  onSelect={(assetId) => {
                    const asset = assets.find((entry) => entry.id === assetId)
                    if (asset) {
                      onSelect(asset)
                      setIsOpen(true)
                      setPicker(null)
                    }
                  }}
                />
              ),
            } : undefined}
            onSelect={(image) => {
              if (!image || !picker) {
                return
              }
              if (picker.mode === 'replace') {
                onImageChange(picker.index, image)
              } else {
                onAddImage(image)
                setIsOpen(true)
              }
            }}
          />
        </>
      )}
    >
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 8.5rem), 1fr))' }}>
        {references.map((reference, index) => {
          const title = reference.image?.fileName || t({ ko: '참조 {index}', en: 'Reference {index}' }, { index: index + 1 })
          const replaceImage = () => setPicker({ mode: 'replace', index })
          return (
            <div key={index} className="grid min-w-0 max-w-48 content-start gap-2">
              <OverlayCard
                mediaClassName="aspect-square"
                media={reference.image ? (
                  <img src={reference.image.dataUrl} alt="" className="size-full bg-checker object-contain" />
                ) : (
                  <div className="flex size-full items-center justify-center bg-field text-muted-foreground"><ImageIcon /></div>
                )}
                label={t({ ko: '{name} 이미지 교체', en: 'Replace the image for {name}' }, { name: title })}
                title={title}
                onOpen={replaceImage}
                menu={[
                  { key: 'replace', label: replaceLabel, icon: ImagePlus, onSelect: replaceImage },
                  onSave ? {
                    key: 'save',
                    label: t({ ko: '라이브러리에 저장', en: 'Save to library' }),
                    icon: Save,
                    onSelect: () => onSave(index),
                    disabled: !canEdit || !canViewImages || !reference.image,
                  } : null,
                  {
                    key: 'remove',
                    label: t('image-generation.components.nai.common.remove'),
                    icon: Trash2,
                    onSelect: () => onRemove(index),
                    destructive: true,
                  },
                ]}
              />
              <Field label={t({ ko: '유형', en: 'Type' })}>
                <Select
                  value={reference.type}
                  onChange={(event) => onFieldChange(index, { type: event.target.value as NAICharacterReferenceDraft['type'] })}
                >
                  <option value="character">{t({ ko: '캐릭터', en: 'Character' })}</option>
                  <option value="style">{t({ ko: '스타일', en: 'Style' })}</option>
                  <option value="character&style">{t({ ko: '캐릭터+스타일', en: 'Character + Style' })}</option>
                  {v5 || reference.type === 'outfit' ? (
                    <option value="outfit" disabled={!v5}>{t({ ko: '의상', en: 'Outfit' })}</option>
                  ) : null}
                </Select>
              </Field>
              <Field label={strengthLabel}>
                <NumberStepperInput
                  aria-label={strengthLabel}
                  min={0}
                  max={v5 ? 5 : 1}
                  step={0.01}
                  value={reference.strength}
                  onValueCommit={(strength) => onFieldChange(index, { strength })}
                />
              </Field>
              {v5 && (reference.type === 'character' || reference.type === 'character&style') ? (
                <SwitchLine
                  label={t({ ko: '같은 의상 우선', en: 'Prefer same outfit' })}
                  checked={reference.preferSameOutfit === true}
                  onCheckedChange={(preferSameOutfit) => onFieldChange(index, { preferSameOutfit })}
                />
              ) : null}
              {!v5 ? (
                <Field label={fidelityLabel}>
                  <NumberStepperInput aria-label={fidelityLabel} min={0} max={1} step={0.01} value={reference.fidelity} onValueCommit={(fidelity) => onFieldChange(index, { fidelity })} />
                </Field>
              ) : null}
            </div>
          )
        })}
        {supportsCharacterReference ? (
          <Panel asChild tone="lowest" padding="none" interactive treatment="drop">
            <button
              type="button"
              aria-label={addLabel}
              title={addLabel}
              className="flex aspect-square w-full max-w-48 items-center justify-center self-start text-muted-foreground"
              onClick={() => setPicker({ mode: 'add' })}
            >
              <Plus className="size-5" />
            </button>
          </Panel>
        ) : null}
      </div>
    </Section>
  )
}
