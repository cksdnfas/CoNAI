import { Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import type { StoredNaiCharacterReferenceAsset } from '@/lib/api'
import { FormField, type NAICharacterReferenceDraft, type SelectedImageDraft } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { NaiControllerSection } from './nai-generation-panel-sections'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { NaiSavedAssetTile } from './nai-saved-asset-tile'
import { NaiSavedImageBrowserSection } from './nai-saved-image-browser-section'

export interface NaiReferencesSectionProps {
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
  return (
    <div className="space-y-0">
      <NaiControllerSection
        heading="References"
        className="rounded-b-none border-b-0"
        actions={(
          <>
            <Badge variant="outline">{references.length}</Badge>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={onAddReference}
              disabled={!supportsCharacterReference}
              aria-label="Reference 추가"
              title="Reference 추가"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        )}
      >
        {!supportsCharacterReference ? <div className="text-xs text-[#ffb4ab]">현재 모델에서는 Character Reference를 사용할 수 없어.</div> : null}

        {references.length > 0 ? (
          <div className="overflow-hidden rounded-sm border border-border/85 divide-y divide-border/85 bg-surface-low/40">
            {references.map((reference, index) => (
              <div key={`nai-character-reference-${index}`} className="space-y-4 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">Reference {index + 1}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ImageAttachmentPickerButton label={reference.image ? '참조 이미지 변경' : '참조 이미지 선택'} modalTitle={`Reference ${index + 1} 이미지 선택`} allowSaveDialog={false} onSelect={(image) => onReferenceImageChange(index, image)} />
                    <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveReference(index)}>
                      <Trash2 className="h-4 w-4" />
                      제거
                    </Button>
                  </div>
                </div>

                {reference.image ? <NaiSelectedImageCard image={reference.image} alt={`NAI character reference ${index + 1}`} /> : null}

                <div className="grid gap-4 md:grid-cols-3">
                  <FormField label="Type">
                    <Select value={reference.type} onChange={(event) => onReferenceFieldChange(index, 'type', event.target.value)}>
                      <option value="character">character</option>
                      <option value="style">style</option>
                      <option value="character&style">character&style</option>
                    </Select>
                  </FormField>
                  <FormField label="Strength">
                    <ScrubbableNumberInput min={0} max={1} step={0.01} value={reference.strength} onChange={(value) => onReferenceFieldChange(index, 'strength', value)} />
                  </FormField>
                  <FormField label="Fidelity">
                    <ScrubbableNumberInput min={0} max={1} step={0.01} value={reference.fidelity} onChange={(value) => onReferenceFieldChange(index, 'fidelity', value)} />
                  </FormField>
                </div>

                <div className="flex justify-end border-t border-border/70 pt-3">
                  <Button type="button" variant="outline" onClick={() => onOpenReferenceSaveModal(index)} disabled={!reference.image}>
                    <Save className="h-4 w-4" />
                    저장
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </NaiControllerSection>

      <NaiSavedImageBrowserSection
        count={savedReferences.length}
        searchValue={savedReferenceSearch}
        isLoading={savedReferencesLoading}
        emptyMessage="검색 결과가 없거나 저장된 reference가 없어."
        className="rounded-t-none"
        onSearchChange={onSavedReferenceSearchChange}
      >
        <div className="max-h-[41rem] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
