import { Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { useI18n } from '@/i18n'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import type { StoredNaiCharacterReferenceAsset } from '@/lib/api-image-generation-types'
import { FormField, type NAICharacterReferenceDraft, type SelectedImageDraft } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { Section } from '@/components/ui/section'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { NaiSavedAssetTile } from './nai-saved-asset-tile'
import { NaiSavedImageBrowserSection } from './nai-saved-image-browser-section'

interface NaiReferencesSectionProps {
  supportsCharacterReference: boolean
  references: NAICharacterReferenceDraft[]
  savedReferences: StoredNaiCharacterReferenceAsset[]
  savedReferenceSearch: string
  savedReferencesLoading: boolean
  onSavedReferenceSearchChange: (value: string) => void
  onAddReference: () => void
  onRemoveReference: (index: number) => void
  onReferenceImageChange: (index: number, image?: SelectedImageDraft) => void
  onReferenceFieldChange: (index: number, field: 'type' | 'strength' | 'fidelity', value: string) => void
  onOpenReferenceSaveModal: (index: number) => void
  onLoadReferenceFromStore: (assetId: string) => void
  onEditReferenceFromStore: (assetId: string) => void
  onDeleteReferenceFromStore: (assetId: string) => void
}

/** Render the Character References editor and saved-reference browser for NAI generation. */
export function NaiReferencesSection({
  supportsCharacterReference,
  references,
  savedReferences,
  savedReferenceSearch,
  savedReferencesLoading,
  onSavedReferenceSearchChange,
  onAddReference,
  onRemoveReference,
  onReferenceImageChange,
  onReferenceFieldChange,
  onOpenReferenceSaveModal,
  onLoadReferenceFromStore,
  onEditReferenceFromStore,
  onDeleteReferenceFromStore,
}: NaiReferencesSectionProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-0">
      <Section
        variant="controller"
        heading={t({ ko: '레퍼런스', en: 'References' })}
        collapsible
        defaultOpen={false}
        className="rounded-b-none @container"
        actions={(
          <>
            <Badge variant="outline">{references.length}</Badge>
            <IconButton
              size="icon-sm"
              variant="secondary"
              onClick={onAddReference}
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
                      onSelect={(image) => onReferenceImageChange(index, image)}
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveReference(index)}>
                      <Trash2 />
                      {t('image-generation.components.nai.common.remove')}
                    </Button>
                  </div>
                </div>

                {reference.image ? <NaiSelectedImageCard image={reference.image} alt={`NAI character reference ${index + 1}`} /> : null}

                <div className="grid gap-4 @lg:grid-cols-3">
                  <FormField label={t({ ko: '유형', en: 'Type' })}>
                    <Select value={reference.type} onChange={(event) => onReferenceFieldChange(index, 'type', event.target.value)}>
                      <option value="character">character</option>
                      <option value="style">style</option>
                      <option value="character&style">character&style</option>
                    </Select>
                  </FormField>
                  <FormField label={t({ ko: '강도', en: 'Strength' })}>
                    <NumberStepperInput min={0} max={1} step={0.01} value={reference.strength} onValueCommit={(value) => onReferenceFieldChange(index, 'strength', value)} />
                  </FormField>
                  <FormField label={t({ ko: '충실도', en: 'Fidelity' })}>
                    <NumberStepperInput min={0} max={1} step={0.01} value={reference.fidelity} onValueCommit={(value) => onReferenceFieldChange(index, 'fidelity', value)} />
                  </FormField>
                </div>

                <div className="flex justify-end">
                  <Button type="button" variant="secondary" onClick={() => onOpenReferenceSaveModal(index)} disabled={!reference.image}>
                    <Save className="h-4 w-4" />
                    {t('image-generation.components.nai.common.save')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      <NaiSavedImageBrowserSection
        count={savedReferences.length}
        searchValue={savedReferenceSearch}
        isLoading={savedReferencesLoading}
        emptyMessage={t('image-generation.components.nai.references.section.no.search.results.or.saved.references')}
        className="rounded-t-none @container"
        onSearchChange={onSavedReferenceSearchChange}
      >
        <div className="max-h-[41rem] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3">
            {savedReferences.map((asset) => (
              <NaiSavedAssetTile
                key={asset.id}
                title={asset.label}
                subtitle={asset.description?.trim() || asset.type}
                imageUrl={asset.thumbnail_url || asset.image_url || asset.image_data_url}
                onSelect={() => onLoadReferenceFromStore(asset.id)}
                onEdit={() => onEditReferenceFromStore(asset.id)}
                onDelete={() => onDeleteReferenceFromStore(asset.id)}
              />
            ))}
          </div>
        </div>
      </NaiSavedImageBrowserSection>
    </div>
  )
}
