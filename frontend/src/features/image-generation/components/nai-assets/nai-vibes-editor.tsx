import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Section } from '@/components/ui/section'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { StoredNaiVibeAsset } from '@/lib/api-image-generation-types'
import { FormField, type NAIVibeDraft, type SelectedImageDraft } from '../../image-generation-shared'
import { ImageAttachmentPickerButton } from '../image-attachment-picker'
import { NaiAssetRow } from './nai-asset-row'
import { NaiSavedAssetBrowser, type NaiSavedAssetBrowserProps } from './nai-saved-asset-browser'

/** Saved-vibe library wiring: the caller owns fetching/filtering, so each surface keeps its own query + search rules. */
export type NaiVibeLibraryProps = Omit<NaiSavedAssetBrowserProps, 'items' | 'onSelect' | 'emptyMessage'> & {
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
  /**
   * True when a vibe with an image but no encoding gets encoded on submit (generation page).
   * False (module graph) marks such rows as needing an encoding, since nothing encodes them later.
   */
  encodesOnSubmit?: boolean
  /** Append one new vibe row from a picked image. */
  onAddImage: (image: SelectedImageDraft) => void
  onRemove: (index: number) => void
  onImageChange: (index: number, image?: SelectedImageDraft) => void
  onFieldChange: (index: number, field: 'strength' | 'informationExtracted', value: string) => void
  /** Renders the raw encoded payload textarea in the row menu (module graph accepts pasted encodings). */
  onEncodedChange?: (index: number, value: string) => void
  /** Per-row "save to library" action; omit to hide it. */
  save?: {
    onSave: (index: number) => void
    encodingIndex: number | null
    /** Set when saving is unavailable (e.g. NovelAI login required); disables the action with this title. */
    unavailableReason?: string
  }
  library: NaiVibeLibraryProps
}

type PickerState = { mode: 'add' } | { mode: 'replace'; index: number } | null

/** Shared NAI vibe-transfer editor used by the NAI generation form and module-graph inputs: compact rows + one add picker. */
export function NaiVibesEditor({
  vibes,
  defaultOpen = false,
  description,
  emptyLabel,
  encodesOnSubmit = false,
  onAddImage,
  onRemove,
  onImageChange,
  onFieldChange,
  onEncodedChange,
  save,
  library,
}: NaiVibesEditorProps) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [picker, setPicker] = useState<PickerState>(null)
  const { assets, emptyMessage, onSelect, ...browserProps } = library

  const renderStatus = (vibe: NAIVibeDraft, index: number) => {
    if (save?.encodingIndex === index) {
      return <Badge variant="info">{t('image-generation.components.nai.vibes.section.encoding')}</Badge>
    }
    if (vibe.encoded.trim()) {
      return <Badge variant="success">{t('image-generation.components.nai.vibes.section.ready')}</Badge>
    }
    if (vibe.image && encodesOnSubmit) {
      return <Badge variant="info">{t('image-generation.components.nai.vibes.section.auto.encode')}</Badge>
    }
    return (
      <Badge variant="warning">
        {vibe.image ? t({ ko: '인코딩 필요', en: 'Encoding required' }) : t('image-generation.components.nai.vibes.section.image.required')}
      </Badge>
    )
  }

  return (
    <Section
      variant="settings"
      heading={t({ ko: '바이브', en: 'Vibes' })}
      description={description}
      collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="@container"
      actions={(
        <>
          <span className="px-1 text-xs tabular-nums text-muted-foreground">{vibes.length}</span>
          <IconButton size="icon-sm" variant="ghost" onClick={() => setPicker({ mode: 'add' })} label={t('image-generation.components.nai.vibes.section.add.vibe')}>
            <Plus />
          </IconButton>
          <ImageAttachmentPickerButton
            hideTrigger
            label={t('image-generation.components.nai.vibes.section.add.vibe')}
            modalTitle={picker?.mode === 'replace'
              ? t('image-generation.components.nai.vibes.section.select.vibe.image.with.index', { index: picker.index + 1 })
              : t('image-generation.components.nai.vibes.section.add.vibe')}
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
                    subtitle: asset.description?.trim() || asset.model,
                    imageUrl: asset.thumbnail_url || asset.image_url || asset.image_data_url,
                  }))}
                  emptyMessage={emptyMessage ?? t('image-generation.components.nai.vibes.section.no.search.results.or.saved.vibes')}
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
      {vibes.length > 0 ? (
        <div className="divide-y divide-line">
          {vibes.map((vibe, index) => (
            <NaiAssetRow
              key={`nai-vibe-${index}`}
              image={vibe.image}
              title={vibe.image?.fileName || `Vibe ${index + 1}`}
              meta={renderStatus(vibe, index)}
              strength={vibe.strength}
              strengthMin={0.01}
              onStrengthCommit={(value) => onFieldChange(index, 'strength', value)}
              menuFields={(
                <>
                  <FormField label={t({ ko: '정보 추출량', en: 'Information Extracted' })}>
                    <NumberStepperInput min={0.01} max={1} step={0.01} value={vibe.informationExtracted} onValueCommit={(value) => onFieldChange(index, 'informationExtracted', value)} />
                  </FormField>
                  {onEncodedChange ? (
                    <FormField label={t({ ko: '인코딩된 데이터', en: 'Encoded' })}>
                      <Textarea rows={3} value={vibe.encoded} onChange={(event) => onEncodedChange(index, event.target.value)} placeholder={t({ ko: '인코딩된 Vibe 데이터', en: 'Encoded Vibe payload' })} />
                    </FormField>
                  ) : null}
                </>
              )}
              onReplaceImage={() => setPicker({ mode: 'replace', index })}
              onSave={save ? () => save.onSave(index) : undefined}
              saveDisabled={!vibe.image || save?.encodingIndex === index || Boolean(save?.unavailableReason)}
              saveTitle={save?.unavailableReason}
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
