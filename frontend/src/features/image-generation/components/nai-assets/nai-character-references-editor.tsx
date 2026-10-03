import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { StoredNaiCharacterReferenceAsset } from '@/lib/api-image-generation-types'
import { FormField, type NAICharacterReferenceDraft, type SelectedImageDraft } from '../../image-generation-shared'
import { ImageAttachmentPickerButton } from '../image-attachment-picker'
import { NaiAssetRow } from './nai-asset-row'
import { NaiSavedAssetBrowser, type NaiSavedAssetBrowserProps } from './nai-saved-asset-browser'

/** Saved-reference library wiring: the caller owns fetching/filtering, so each surface keeps its own query + search rules. */
export type NaiCharacterReferenceLibraryProps = Omit<NaiSavedAssetBrowserProps, 'items' | 'onSelect' | 'emptyMessage'> & {
  assets: StoredNaiCharacterReferenceAsset[]
  emptyMessage?: string
  onSelect: (asset: StoredNaiCharacterReferenceAsset) => void
}

type NaiCharacterReferencesEditorProps = {
  references: NAICharacterReferenceDraft[]
  /** False disables adding rows and shows the "not available for this model" note. */
  supportsCharacterReference?: boolean
  /** Section starts collapsed on the generation page; inline editors (module graph) open it. */
  defaultOpen?: boolean
  description?: ReactNode
  /** Shown when there are no rows; omit to render nothing. */
  emptyLabel?: string
  /** Append one new reference row from a picked image. */
  onAddImage: (image: SelectedImageDraft) => void
  onRemove: (index: number) => void
  onImageChange: (index: number, image?: SelectedImageDraft) => void
  onFieldChange: (index: number, field: 'type' | 'strength' | 'fidelity', value: string) => void
  /** Per-row "save to library" action; omit to hide it. */
  onSave?: (index: number) => void
  library: NaiCharacterReferenceLibraryProps
}

type PickerState = { mode: 'add' } | { mode: 'replace'; index: number } | null

/** Shared NAI character-reference editor used by the NAI generation form and module-graph inputs: compact rows + one add picker. */
export function NaiCharacterReferencesEditor({
  references,
  supportsCharacterReference = true,
  defaultOpen = false,
  description,
  emptyLabel,
  onAddImage,
  onRemove,
  onImageChange,
  onFieldChange,
  onSave,
  library,
}: NaiCharacterReferencesEditorProps) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [picker, setPicker] = useState<PickerState>(null)
  const { assets, emptyMessage, onSelect, ...browserProps } = library

  return (
    <Section
      variant="settings"
      heading={t({ ko: '레퍼런스', en: 'References' })}
      description={description}
      collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="@container"
      actions={(
        <>
          <span className="px-1 text-xs tabular-nums text-muted-foreground">{references.length}</span>
          <IconButton
            size="icon-sm"
            variant="ghost"
            onClick={() => setPicker({ mode: 'add' })}
            disabled={!supportsCharacterReference}
            label={t('image-generation.components.nai.references.section.add.reference')}
          >
            <Plus />
          </IconButton>
          <ImageAttachmentPickerButton
            hideTrigger
            label={t('image-generation.components.nai.references.section.add.reference')}
            modalTitle={picker?.mode === 'replace'
              ? t('image-generation.components.nai.references.section.select.reference.image.with.index', { index: picker.index + 1 })
              : t('image-generation.components.nai.references.section.add.reference')}
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
      {!supportsCharacterReference ? <Text variant="caption" className="text-destructive">{t('image-generation.components.nai.references.section.character.reference.is.not.available.for.the')}</Text> : null}

      {references.length > 0 ? (
        <div className="divide-y divide-line">
          {references.map((reference, index) => (
            <NaiAssetRow
              key={`nai-character-reference-${index}`}
              image={reference.image}
              title={reference.image?.fileName || `Reference ${index + 1}`}
              meta={(
                <select
                  aria-label={t({ ko: '유형', en: 'Type' })}
                  value={reference.type}
                  onChange={(event) => onFieldChange(index, 'type', event.target.value)}
                  className="-ml-1 h-6 max-w-full cursor-pointer field-sizing-content rounded-sm bg-transparent px-1 text-xs text-muted-foreground outline-none hover:bg-field focus-visible:ring-2 focus-visible:ring-primary/15"
                >
                  <option value="character">{t({ ko: '캐릭터', en: 'Character' })}</option>
                  <option value="style">{t({ ko: '스타일', en: 'Style' })}</option>
                  <option value="character&style">{t({ ko: '캐릭터+스타일', en: 'Character + Style' })}</option>
                </select>
              )}
              strength={reference.strength}
              strengthMin={0}
              onStrengthCommit={(value) => onFieldChange(index, 'strength', value)}
              menuFields={(
                <FormField label={t({ ko: '충실도', en: 'Fidelity' })}>
                  <NumberStepperInput min={0} max={1} step={0.01} value={reference.fidelity} onValueCommit={(value) => onFieldChange(index, 'fidelity', value)} />
                </FormField>
              )}
              onReplaceImage={() => setPicker({ mode: 'replace', index })}
              onSave={onSave ? () => onSave(index) : undefined}
              saveDisabled={!reference.image}
              onRemove={() => onRemove(index)}
            />
          ))}
        </div>
      ) : emptyLabel ? (
        <EmptyState size="compact" title={emptyLabel} />
      ) : null}
    </Section>
  )
}
