import { Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import type { StoredNaiVibeAsset } from '@/lib/api'
import { FormField, type NAIVibeDraft, type SelectedImageDraft } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { NaiControllerSection } from './nai-generation-panel-sections'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { NaiSavedAssetTile } from './nai-saved-asset-tile'
import { NaiSavedImageBrowserSection } from './nai-saved-image-browser-section'

export interface NaiVibesSectionProps {
  vibes: NAIVibeDraft[]
  encodingVibeIndex: number | null
  naiConnected: boolean
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
  onEditVibeFromStore: (assetId: string) => void
  onDeleteVibeFromStore: (assetId: string) => void
}

/** Render the Vibes editor and saved-vibes browser for the NAI generation form. */
export function NaiVibesSection({
  vibes,
  encodingVibeIndex,
  naiConnected,
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
  onEditVibeFromStore,
  onDeleteVibeFromStore,
}: NaiVibesSectionProps) {
  return (
    <div className="space-y-0">
      <NaiControllerSection
        heading="Vibes"
        className="rounded-b-none border-b-0"
        actions={(
          <>
            <Badge variant="outline">{vibes.length}</Badge>
            <Button type="button" size="icon-sm" variant="outline" onClick={onAddVibe} aria-label="Vibe 추가" title="Vibe 추가">
              <Plus className="h-4 w-4" />
            </Button>
          </>
        )}
      >
        {vibes.length > 0 ? (
          <div className="overflow-hidden rounded-sm border border-border/85 divide-y divide-border/85 bg-surface-low/40">
            {vibes.map((vibe, index) => (
              <div key={`nai-vibe-${index}`} className="space-y-4 px-3 py-3">
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
                    <ImageAttachmentPickerButton label={vibe.image ? '참조 이미지 변경' : '참조 이미지 선택'} modalTitle={`Vibe ${index + 1} 이미지 선택`} allowSaveDialog={false} onSelect={(image) => onVibeImageChange(index, image)} />
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

                <div className="flex justify-end border-t border-border/70 pt-3">
                  <Button type="button" variant="outline" onClick={() => onOpenVibeSaveModal(index)} disabled={!vibe.image || encodingVibeIndex === index || !naiConnected} title={!naiConnected ? 'Vibe 저장은 NovelAI 로그인 상태가 필요해.' : undefined}>
                    <Save className="h-4 w-4" />
                    {encodingVibeIndex === index ? '인코딩 중…' : '저장'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </NaiControllerSection>

      <NaiSavedImageBrowserSection
        count={savedVibes.length}
        searchValue={savedVibeSearch}
        isLoading={savedVibesLoading}
        emptyMessage={naiConnected ? '검색 결과가 없거나 저장된 vibe가 없어.' : '저장된 Vibe를 보거나 저장하려면 NovelAI 로그인이 필요해.'}
        className="rounded-t-none"
        onSearchChange={onSavedVibeSearchChange}
      >
        <div className="max-h-[41rem] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {savedVibes.map((asset) => (
              <NaiSavedAssetTile
                key={asset.id}
                title={asset.label}
                subtitle={asset.description?.trim() || asset.model}
                imageUrl={asset.thumbnail_url || asset.image_url || asset.image_data_url}
                onSelect={() => onLoadVibeFromStore(asset.id)}
                onEdit={() => onEditVibeFromStore(asset.id)}
                onDelete={() => onDeleteVibeFromStore(asset.id)}
              />
            ))}
          </div>
        </div>
      </NaiSavedImageBrowserSection>
    </div>
  )
}
