import { Plus, Save, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import type { StoredNaiCharacterReferenceAsset } from '@/lib/api'
import { FormField, type NAICharacterReferenceDraft, type SelectedImageDraft } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { NaiSelectedImageCard } from './nai-selected-image-card'

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
  onDeleteReferenceFromStore,
}: NaiReferencesSectionProps) {
  return (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-5">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 pb-4"
            heading="References"
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
          />

          {!supportsCharacterReference ? <div className="text-xs text-[#ffb4ab]">현재 모델에서는 Character Reference를 사용할 수 없어.</div> : null}

          {references.length > 0 ? (
            <div className="space-y-4">
              {references.map((reference, index) => (
                <div key={`nai-character-reference-${index}`} className="space-y-4 rounded-sm border border-border bg-surface-low p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">Reference {index + 1}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ImageAttachmentPickerButton label={reference.image ? '참조 이미지 변경' : '참조 이미지 선택'} modalTitle={`Reference ${index + 1} 이미지 선택`} onSelect={(image) => onReferenceImageChange(index, image)} />
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

                  <div className="flex justify-end border-t border-border/70 pt-4">
                    <Button type="button" variant="outline" onClick={() => onOpenReferenceSaveModal(index)} disabled={!reference.image}>
                      <Save className="h-4 w-4" />
                      저장
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-border bg-surface-low px-4 py-5 text-sm text-muted-foreground">
              아직 추가한 reference가 없어.
            </div>
          )}

          <div className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-foreground">Saved Character References</div>
                <Badge variant="outline">{savedReferences.length}</Badge>
              </div>
              <div className="w-full sm:w-72 md:w-80">
                <Input value={savedReferenceSearch} onChange={(event) => onSavedReferenceSearchChange(event.target.value)} placeholder="이름 / 설명 검색" />
              </div>
            </div>
            {savedReferencesLoading ? (
              <div className="text-sm text-muted-foreground">불러오는 중…</div>
            ) : savedReferences.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {savedReferences.map((asset) => (
                  <div key={asset.id} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                    <div className="flex gap-3">
                      <img src={asset.image_data_url} alt={asset.label} className="h-20 w-20 shrink-0 rounded-sm border border-border object-contain" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="truncate text-sm font-medium text-foreground">{asset.label}</div>
                        {asset.description ? <div className="line-clamp-2 text-xs text-muted-foreground">{asset.description}</div> : null}
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline">{asset.type}</Badge>
                          <Badge variant="outline">strength {asset.strength}</Badge>
                          <Badge variant="outline">fidelity {asset.fidelity}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-border/70 pt-3">
                      <Button type="button" size="sm" variant="outline" onClick={() => onLoadReferenceFromStore(asset.id)}>불러오기</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => onDeleteReferenceFromStore(asset.id)}>삭제</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">검색 결과가 없거나 저장된 reference가 없어.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
