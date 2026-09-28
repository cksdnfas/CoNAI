import type { ReactNode } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { StoredNaiVibeAsset } from '@/lib/api-image-generation-types'
import { FormField, type NAIVibeDraft, type SelectedImageDraft } from '../../image-generation-shared'
import { ImageAttachmentPickerButton } from '../image-attachment-picker'
import { NaiSelectedImageCard } from '../nai-selected-image-card'
import { NaiSavedAssetBrowser, type NaiSavedAssetBrowserProps } from './nai-saved-asset-browser'

/** Saved-vibe library wiring: the caller owns fetching/filtering, so each surface keeps its own query + search rules. */
export type NaiVibeLibraryProps = Omit<NaiSavedAssetBrowserProps, 'items' | 'onSelect' | 'emptyMessage' | 'title' | 'className'> & {
  assets: StoredNaiVibeAsset[]
  emptyMessage?: string
  onSelect: (asset: StoredNaiVibeAsset) => void
}

type NaiVibesEditorProps = {
  vibes: NAIVibeDraft[]
  /** Section starts collapsed on the generation page; inline editors (module graph) open it. */
  defaultOpen?: boolean
  description?: ReactNode
  /** Shown when there are no rows; omit to render nothing. */
  emptyLabel?: string
  /** Ready / auto-encode / image-required badges (generation page encodes on submit). */
  showEncodeStatus?: boolean
  onAdd: () => void
  onRemove: (index: number) => void
  onImageChange: (index: number, image?: SelectedImageDraft) => void
  onFieldChange: (index: number, field: 'strength' | 'informationExtracted', value: string) => void
  /** Renders the raw encoded payload textarea (module graph accepts pasted encodings). */
  onEncodedChange?: (index: number, value: string) => void
  /** Per-row "save to library" action; omit to hide it. */
  save?: {
    onSave: (index: number) => void
    encodingIndex: number | null
    /** Set when saving is unavailable (e.g. NovelAI login required); disables the button with this title. */
    unavailableReason?: string
  }
  library: NaiVibeLibraryProps
}

/** Shared NAI vibe-transfer editor (rows + saved-vibe library) used by the NAI generation form and module-graph inputs. */
export function NaiVibesEditor({
  vibes,
  defaultOpen = false,
  description,
  emptyLabel,
  showEncodeStatus = false,
  onAdd,
  onRemove,
  onImageChange,
  onFieldChange,
  onEncodedChange,
  save,
  library,
}: NaiVibesEditorProps) {
  const { t } = useI18n()
  const { assets, emptyMessage, onSelect, ...browserProps } = library

  return (
    <div className="space-y-0">
      <Section
        variant="controller"
        heading={t({ ko: '바이브', en: 'Vibes' })}
        description={description}
        collapsible
        defaultOpen={defaultOpen}
        className="rounded-b-none @container"
        actions={(
          <>
            <Badge variant="outline">{vibes.length}</Badge>
            <IconButton size="icon-sm" variant="secondary" onClick={onAdd} label={t('image-generation.components.nai.vibes.section.add.vibe')}>
              <Plus />
            </IconButton>
          </>
        )}
      >
        {vibes.length > 0 ? (
          <div className="divide-y divide-outline-subtle">
            {vibes.map((vibe, index) => (
              <div key={`nai-vibe-${index}`} className="space-y-4 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text as="div" variant="label">Vibe {index + 1}</Text>
                    {!showEncodeStatus ? null : vibe.encoded ? (
                      <Badge variant="success">{t('image-generation.components.nai.vibes.section.ready')}</Badge>
                    ) : vibe.image ? (
                      <Badge variant="info">{t('image-generation.components.nai.vibes.section.auto.encode')}</Badge>
                    ) : (
                      <Badge variant="warning">{t('image-generation.components.nai.vibes.section.image.required')}</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ImageAttachmentPickerButton
                      label={vibe.image
                        ? t('image-generation.components.nai.vibes.section.change.reference.image')
                        : t('image-generation.components.nai.vibes.section.select.reference.image')}
                      modalTitle={t('image-generation.components.nai.vibes.section.select.vibe.image.with.index', { index: index + 1 })}
                      allowSaveDialog={false}
                      onSelect={(image) => onImageChange(index, image)}
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(index)}>
                      <Trash2 />
                      {t('image-generation.components.nai.common.remove')}
                    </Button>
                  </div>
                </div>

                {vibe.image ? <NaiSelectedImageCard image={vibe.image} alt={`NAI vibe ${index + 1}`} /> : null}

                {onEncodedChange ? (
                  <FormField label={t({ ko: '인코딩된 데이터', en: 'Encoded' })}>
                    <Textarea rows={4} value={vibe.encoded} onChange={(event) => onEncodedChange(index, event.target.value)} placeholder={t({ ko: '인코딩된 Vibe 데이터', en: 'Encoded Vibe payload' })} />
                  </FormField>
                ) : null}

                <div className="grid gap-4 @sm:grid-cols-2">
                  <FormField label={t({ ko: '강도', en: 'Strength' })}>
                    <NumberStepperInput min={0.01} max={1} step={0.01} value={vibe.strength} onValueCommit={(value) => onFieldChange(index, 'strength', value)} />
                  </FormField>
                  <FormField label={t({ ko: '정보 추출량', en: 'Information Extracted' })}>
                    <NumberStepperInput min={0.01} max={1} step={0.01} value={vibe.informationExtracted} onValueCommit={(value) => onFieldChange(index, 'informationExtracted', value)} />
                  </FormField>
                </div>

                {save ? (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => save.onSave(index)}
                      disabled={!vibe.image || save.encodingIndex === index || Boolean(save.unavailableReason)}
                      title={save.unavailableReason}
                    >
                      <Save className="h-4 w-4" />
                      {save.encodingIndex === index ? t('image-generation.components.nai.vibes.section.encoding') : t('image-generation.components.nai.vibes.section.save')}
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
        title={t({ ko: '저장된 바이브', en: 'Saved vibes' })}
        items={assets.map((asset) => ({
          id: asset.id,
          title: asset.label,
          subtitle: asset.description?.trim() || asset.model,
          imageUrl: asset.thumbnail_url || asset.image_url || asset.image_data_url,
        }))}
        emptyMessage={emptyMessage ?? t('image-generation.components.nai.vibes.section.no.search.results.or.saved.vibes')}
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
