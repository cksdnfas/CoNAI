import { useId, useState } from 'react'
import { Palette, UserRound } from 'lucide-react'
import { ImageChoiceGrid } from '@/components/common/image-choice-grid'
import { Button } from '@/components/ui/button'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { ArtStylePickerDialog } from '@/features/art-styles/components/art-style-picker-dialog'
import { characterImageUrl, characterThumbnailUrl } from '@/features/characters/character-library-shared'
import { CharacterSettingPickerDialog } from '@/features/characters/components/character-setting-picker-dialog'
import { useI18n } from '@/i18n'
import { artStyleImageUrl, artStyleThumbnailUrl, type ArtStyle } from '@/lib/api-art-styles'
import type { CharacterSetting } from '@/lib/api-character-library'
import { characterSettingImages } from '../character-setting-load'

/** One image of a character setting or an art style, picked to go into an image slot. */
export type LibraryItemImage = { url: string; name: string; libraryHash?: string }

type Picked = { kind: 'character'; setting: CharacterSetting } | { kind: 'style'; style: ArtStyle }

/**
 * The image picker's "캐릭터" / "스타일" tab: choose a character setting or an art style (the library's own pickers),
 * then one of its images. Opens the chooser at once; "다른 …" chooses again.
 */
export function LibraryItemImageSource({ kind, busy, onPick }: { kind: 'character' | 'style'; busy: boolean; onPick: (image: LibraryItemImage) => void }) {
  const { t } = useI18n()
  const captionId = useId()
  const [picked, setPicked] = useState<Picked | null>(null)
  const [chooserOpen, setChooserOpen] = useState(true)
  const [chosen, setChosen] = useState<string | null>(null)
  const isCharacter = kind === 'character'
  const chooseLabel = isCharacter ? t({ ko: '캐릭터 고르기', en: 'Choose character' }) : t({ ko: '스타일 고르기', en: 'Choose art style' })
  const Icon = isCharacter ? UserRound : Palette

  const images = !picked ? [] : picked.kind === 'character'
    ? characterSettingImages(picked.setting).map((image, index, all) => ({ key: image.hash, src: characterThumbnailUrl(image.hash), marked: image.isReference, label: `${image.category ?? t({ ko: '이미지', en: 'Image' })} ${index + 1}/${all.length}`, url: characterImageUrl(image.hash), libraryHash: image.hash }))
    : picked.style.images.map((image, index, all) => ({ key: image.id, src: artStyleThumbnailUrl(picked.style.id, image.id), marked: index === 0, label: `${index === 0 ? t({ ko: '대표', en: 'Cover' }) : t({ ko: '이미지', en: 'Image' })} ${index + 1}/${all.length}`, url: artStyleImageUrl(picked.style.id, image.id), libraryHash: undefined }))
  const name = !picked ? '' : picked.kind === 'character' ? picked.setting.name : picked.style.title
  const choose = (next: Picked, keys: string[]) => { setPicked(next); setChosen(keys[0] ?? null) }
  const confirm = () => {
    const image = images.find((entry) => entry.key === chosen)
    if (image) onPick({ url: image.url, name, libraryHash: image.libraryHash })
  }

  return (
    <div className="space-y-3">
      {picked ? (
        <>
          <div className="flex items-center gap-2">
            <Text as="span" variant="label" id={captionId} className="min-w-0 flex-1 truncate">{name}</Text>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setChooserOpen(true)}>{chooseLabel}</Button>
          </div>
          {images.length ? (
            <ImageChoiceGrid labelledBy={captionId} disabled={busy} chosen={chosen ? [chosen] : []} onToggle={(key) => setChosen((current) => (current === key ? null : key))} images={images}
              fallback={<span className="flex size-full items-center justify-center text-muted-foreground"><Icon className="size-6" /></span>} />
          ) : <EmptyState size="compact" icon={Icon} title={t({ ko: '등록된 이미지가 없어', en: 'No images' })} />}
          <EditorFooter onSave={confirm} canSave={Boolean(chosen)} saving={busy} saveLabel={t({ ko: '불러오기', en: 'Load' })} />
        </>
      ) : (
        <EmptyState size="compact" icon={Icon} title={chooseLabel} action={<Button size="sm" onClick={() => setChooserOpen(true)}>{chooseLabel}</Button>} />
      )}
      {isCharacter
        ? <CharacterSettingPickerDialog open={chooserOpen} onOpenChange={setChooserOpen} title={chooseLabel} onPick={(setting) => choose({ kind: 'character', setting }, characterSettingImages(setting).map((image) => image.hash))} />
        : <ArtStylePickerDialog open={chooserOpen} onOpenChange={setChooserOpen} title={chooseLabel} onPick={(style) => choose({ kind: 'style', style }, style.images.map((image) => image.id))} />}
    </div>
  )
}
