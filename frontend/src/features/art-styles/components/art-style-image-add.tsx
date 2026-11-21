import { useRef, useState } from 'react'
import { ChevronDown, Folder, Image, Upload } from 'lucide-react'
import { MediaLibraryPicker } from '@/components/media/media-library-picker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/loading-state'
import { FilePicker } from '@/features/files/file-browser'
import { PROFILE_IMAGE_ACCEPT } from '@/features/settings/components/chat-profile-asset-input'
import { useI18n } from '@/i18n'
import type { ArtStyleDraftImage } from '../use-art-style-editor'

const FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/**
 * The art style's "추가 ▾": pick from the library (`{ composite_hash }`), upload files (staged, never a library image;
 * `onUpload`) or pick from the file store (`{ file_id }`). Each lands in the draft; 저장 copies them into the style.
 */
export function ArtStyleImageAdd({ disabled, busy, room, canUpload, canPickFiles, onAdd, onUpload }: {
  disabled: boolean
  busy: boolean
  /** How many more images fit. */
  room: number
  canUpload: boolean
  canPickFiles: boolean
  onAdd: (images: ArtStyleDraftImage[]) => void
  onUpload: (files: File[]) => void
}) {
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [picker, setPicker] = useState<'library' | 'files' | null>(null)
  const off = disabled || room <= 0
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="compact" variant="secondary" disabled={off}>
          {t({ ko: '추가', en: 'Add' })}
          {busy ? <Spinner className="size-3.5" /> : <ChevronDown />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuItem disabled={off} onSelect={() => setPicker('library')}><Image />{t({ ko: '라이브러리에서 고르기', en: 'Choose from library' })}</DropdownMenuItem>
        {canUpload ? <DropdownMenuItem disabled={off} onSelect={() => fileRef.current?.click()}><Upload />{t({ ko: '파일 올리기', en: 'Upload files' })}</DropdownMenuItem> : null}
        {canPickFiles ? <DropdownMenuItem disabled={off} onSelect={() => setPicker('files')}><Folder />{t({ ko: '파일 보관함에서', en: 'From the file store' })}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    {canUpload ? <input ref={fileRef} type="file" multiple accept={PROFILE_IMAGE_ACCEPT} className="hidden" disabled={off} onChange={(event) => {
      const files = [...(event.target.files ?? [])]
      event.target.value = ''
      if (files.length && !off) onUpload(files.slice(0, room))
    }} /> : null}
    {picker === 'library' ? <MediaLibraryPicker initial={[]} maxCount={Math.max(1, room)} mediaKind="image" title={t({ ko: '이미지 고르기', en: 'Choose images' })} applyLabel={t({ ko: '추가', en: 'Add' })} onClose={() => setPicker(null)} onPick={(items) => {
      setPicker(null)
      if (!off) onAdd(items.map((item) => ({ composite_hash: item.compositeHash })))
    }} /> : null}
    {picker === 'files' ? <FilePicker accept={FILE_EXTENSIONS} title={t({ ko: '보관함 이미지 고르기', en: 'Choose stored images' })} pickLabel={(count) => t({ ko: '{count}장 추가', en: 'Add {count}' }, { count })} onClose={() => setPicker(null)} onPick={(entries) => {
      setPicker(null)
      if (!off) onAdd(entries.filter((entry) => entry.kind === 'file').slice(0, room).map((entry) => ({ file_id: entry.id })))
    }} /> : null}
  </>
}
