import type { ReactNode } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { StoredNaiCharacterReferenceAsset } from '@/lib/api-image-generation-types'
import { FormField, type NAICharacterReferenceDraft, type SelectedImageDraft } from '../../image-generation-shared'
import { ImageAttachmentPickerButton } from '../image-attachment-picker'
import { NaiSelectedImageCard } from '../nai-selected-image-card'
import { NaiSavedAssetBrowser, type NaiSavedAssetBrowserProps } from './nai-saved-asset-browser'

/** Saved-reference library wiring: the caller owns fetching/filtering, so each surface keeps its own query + search rules. */
export type NaiCharacterReferenceLibraryProps = Omit<NaiSavedAssetBrowserProps, 'items' | 'onSelect' | 'emptyMessage' | 'title' | 'className'> & {
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
  onAdd: () => void
  onRemove: (index: number) => void
  onImageChange: (index: number, image?: SelectedImageDraft) => void
  onFieldChange: (index: number, field: 'type' | 'strength' | 'fidelity', value: string) => void
  /** Per-row "save to library" action; omit to hide it. */
  onSave?: (index: number) => void
  library: NaiCharacterReferenceLibraryProps
}

/** Shared NAI character-reference editor (rows + saved-reference library) used by the NAI generation form and module-graph inputs. */
export function NaiCharacterReferencesEditor({
  references,
  supportsCharacterReference = true,
  defaultOpen = false,
  description,
  emptyLabel,
  onAdd,
  onRemove,
  onImageChange,
  onFieldChange,
  onSave,
  library,
}: NaiCharacterReferencesEditorProps) {
  const { t } = useI18n()
  const { assets, emptyMessage, onSelect, ...browserProps } = library

  return (
    <div className="space-y-0">
      <Section
        variant="controller"
        heading={t({ ko: '레퍼런스', en: 'References' })}
        description={description}
        collapsible
        defaultOpen={defaultOpen}
        className="rounded-b-none @container"
        actions={(
          <>
            <Badge variant="outline">{references.length}</Badge>
            <IconButton
              size="icon-sm"
              variant="secondary"
              onClick={onAdd}
              disabled={!supportsCharacterReference}
              label={t('image-generation.components.nai.references.section.add.reference')}
            >
              <Plus />
            </IconButton>
          </>
        )}
      >
        {!supportsCharacterReference ? <Text variant="caption" className="text-destructive">{t('image-generation.components.nai.references.section.character.reference.is.not.available.for.the')}</Text> : null}

        {references.length > 0 ? (
          <div className="divide-y divide-outline-subtle">
            {references.map((reference, index) => (
              <div key={`nai-character-reference-${index}`} className="space-y-4 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Text as="div" variant="label">Reference {index + 1}</Text>
                  <div className="flex flex-wrap items-center gap-2">
                    <ImageAttachmentPickerButton
                      label={reference.image
                        ? t('image-generation.components.nai.references.section.change.reference.image')
                        : t('image-generation.components.nai.references.section.select.reference.image')}
                      modalTitle={t('image-generation.components.nai.references.section.select.reference.image.with.index', { index: index + 1 })}
                      allowSaveDialog={false}
                      onSelect={(image) => onImageChange(index, image)}
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(index)}>
                      <Trash2 />
                      {t('image-generation.components.nai.common.remove')}
                    </Button>
                  </div>
                </div>

                {reference.image ? <NaiSelectedImageCard image={reference.image} alt={`NAI character reference ${index + 1}`} /> : null}

                <div className="grid gap-4 @lg:grid-cols-3">
                  <FormField label={t({ ko: '유형', en: 'Type' })}>
                    <Select value={reference.type} onChange={(event) => onFieldChange(index, 'type', event.target.value)}>
                      <option value="character">{t({ ko: '캐릭터', en: 'Character' })}</option>
                      <option value="style">{t({ ko: '스타일', en: 'Style' })}</option>
                      <option value="character&style">{t({ ko: '캐릭터+스타일', en: 'Character + Style' })}</option>
                    </Select>
                  </FormField>
                  <FormField label={t({ ko: '강도', en: 'Strength' })}>
                    <NumberStepperInput min={0} max={1} step={0.01} value={reference.strength} onValueCommit={(value) => onFieldChange(index, 'strength', value)} />
                  </FormField>
                  <FormField label={t({ ko: '충실도', en: 'Fidelity' })}>
                    <NumberStepperInput min={0} max={1} step={0.01} value={reference.fidelity} onValueCommit={(value) => onFieldChange(index, 'fidelity', value)} />
                  </FormField>
                </div>

                {onSave ? (
                  <div className="flex justify-end">
                    <Button type="button" variant="secondary" onClick={() => onSave(index)} disabled={!reference.image}>
                      <Save className="h-4 w-4" />
                      {t('image-generation.components.nai.common.save')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : emptyLabel ? (
          <EmptyState size="compact" title={emptyLabel} />
        ) : null}
      </Section>

      <NaiSavedAssetBrowser
        {...browserProps}
        title={t({ ko: '저장된 레퍼런스', en: 'Saved references' })}
        items={assets.map((asset) => ({
          id: asset.id,
          title: asset.label,
          subtitle: asset.description?.trim() || asset.type,
          imageUrl: asset.thumbnail_url || asset.image_url || asset.image_data_url,
        }))}
        emptyMessage={emptyMessage ?? t('image-generation.components.nai.references.section.no.search.results.or.saved.references')}
        className="rounded-t-none @container"
        onSelect={(assetId) => {
          const asset = assets.find((entry) => entry.id === assetId)
          if (asset) {
            onSelect(asset)
          }
        }}
      />
    </div>
  )
}
