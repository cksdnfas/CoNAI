import { Plus, Save, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import type { StoredNaiVibeAsset } from '@/lib/api'
import { FormField, type NAIVibeDraft, type SelectedImageDraft } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { NaiSelectedImageCard } from './nai-selected-image-card'

export interface NaiVibesSectionProps {
  vibes: NAIVibeDraft[]
  encodingVibeIndex: number | null
  savedVibes: StoredNaiVibeAsset[]
  savedVibeSearch: string
  savedVibesLoading: boolean
  onSavedVibeSearchChange: (value: string) => void
  onAddVibe: () => void
  onRemoveVibe: (index: number) => void
  onVibeImageChange: (index: number, image?: SelectedImageDraft) => void
  onVibeFieldChange: (index: number, field: 'strength' | 'informationExtracted', value: string) => void
  onOpenVibeSaveModal: (index: number) => void
  onLoadVibeFromStore: (assetId: string) => void
  onDeleteVibeFromStore: (assetId: string) => void
}

/** Render the Vibes editor and saved-vibes browser for the NAI generation form. */
export function NaiVibesSection({
  vibes,
  encodingVibeIndex,
  savedVibes,
  savedVibeSearch,
  savedVibesLoading,
  onSavedVibeSearchChange,
  onAddVibe,
  onRemoveVibe,
  onVibeImageChange,
  onVibeFieldChange,
  onOpenVibeSaveModal,
  onLoadVibeFromStore,
  onDeleteVibeFromStore,
}: NaiVibesSectionProps) {
  return (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-5">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 pb-4"
            heading="Vibes"
            actions={(
              <>
                <Badge variant="outline">{vibes.length}</Badge>
                <Button type="button" size="icon-sm" variant="outline" onClick={onAddVibe} aria-label="Vibe 추가" title="Vibe 추가">
                  <Plus className="h-4 w-4" />
                </Button>
              </>
            )}
          />

          {vibes.length > 0 ? (
            <div className="space-y-4">
              {vibes.map((vibe, index) => (
                <div key={`nai-vibe-${index}`} className="space-y-4 rounded-sm border border-border bg-surface-low p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-foreground">Vibe {index + 1}</div>
                      {vibe.encoded ? (
                        <Badge variant="secondary">준비됨</Badge>
                      ) : vibe.image ? (
                        <Badge variant="outline">자동 인코딩</Badge>
                      ) : (
                        <Badge variant="outline">이미지 필요</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ImageAttachmentPickerButton label={vibe.image ? '참조 이미지 변경' : '참조 이미지 선택'} modalTitle={`Vibe ${index + 1} 이미지 선택`} onSelect={(image) => onVibeImageChange(index, image)} />
                      <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveVibe(index)}>
                        <Trash2 className="h-4 w-4" />
                        제거
                      </Button>
                    </div>
                  </div>

                  {vibe.image ? <NaiSelectedImageCard image={vibe.image} alt={`NAI vibe ${index + 1}`} /> : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Strength">
                      <ScrubbableNumberInput min={0.01} max={1} step={0.01} value={vibe.strength} onChange={(value) => onVibeFieldChange(index, 'strength', value)} />
                    </FormField>
                    <FormField label="Information Extracted">
                      <ScrubbableNumberInput min={0.01} max={1} step={0.01} value={vibe.informationExtracted} onChange={(value) => onVibeFieldChange(index, 'informationExtracted', value)} />
                    </FormField>
                  </div>

                  <div className="flex justify-end border-t border-border/70 pt-4">
                    <Button type="button" variant="outline" onClick={() => onOpenVibeSaveModal(index)} disabled={!vibe.image || encodingVibeIndex === index}>
                      <Save className="h-4 w-4" />
                      {encodingVibeIndex === index ? '인코딩 중…' : '저장'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-border bg-surface-low px-4 py-5 text-sm text-muted-foreground">
              아직 추가한 vibe가 없어.
            </div>
          )}

          <div className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-foreground">Saved Vibes</div>
                <Badge variant="outline">{savedVibes.length}</Badge>
              </div>
              <div className="w-full sm:w-72 md:w-80">
                <Input value={savedVibeSearch} onChange={(event) => onSavedVibeSearchChange(event.target.value)} placeholder="이름 / 설명 검색" />
              </div>
            </div>
            {savedVibesLoading ? (
              <div className="text-sm text-muted-foreground">불러오는 중…</div>
            ) : savedVibes.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {savedVibes.map((asset) => (
                  <div key={asset.id} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                    <div className="flex gap-3">
                      {asset.image_data_url ? (
                        <img src={asset.image_data_url} alt={asset.label} className="h-20 w-20 shrink-0 rounded-sm border border-border object-contain" />
                      ) : (
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-sm border border-dashed border-border text-[11px] text-muted-foreground">
                          no preview
                        </div>
                      )}
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="truncate text-sm font-medium text-foreground">{asset.label}</div>
                        {asset.description ? <div className="line-clamp-2 text-xs text-muted-foreground">{asset.description}</div> : null}
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline">strength {asset.strength}</Badge>
                          <Badge variant="outline">IE {asset.information_extracted}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-border/70 pt-3">
                      <Button type="button" size="sm" variant="outline" onClick={() => onLoadVibeFromStore(asset.id)}>불러오기</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => onDeleteVibeFromStore(asset.id)}>삭제</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">검색 결과가 없거나 저장된 vibe가 없어.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
