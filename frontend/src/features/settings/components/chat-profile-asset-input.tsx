import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, Folder, Image, Link, Upload } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ChatMediaPicker } from '@/features/codex-chat/chat-media-picker'
import { FilePicker } from '@/features/files/file-browser'
import { useI18n } from '@/i18n'
import { downloadChatProfileAsset, importChatProfileAssetFromFileStore, uploadChatProfileAsset, type ChatProfileAssetResult } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'

export const PROFILE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/** All import paths end in the same library pipeline before changing the draft. */
export function useChatProfileAssetImport(onChange: (hash: string) => void, onBusyChange: (busy: boolean) => void) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const active = useRef(true)
  const busy = useRef(false)
  const reportBusy = useRef(onBusyChange)
  reportBusy.current = onBusyChange
  useEffect(() => {
    active.current = true
    return () => { active.current = false; if (busy.current) { busy.current = false; reportBusy.current(false) } }
  }, [])
  return useMutation({
    mutationFn: (task: () => Promise<ChatProfileAssetResult>) => task(),
    onMutate: () => { busy.current = true; reportBusy.current(true) },
    onSuccess: (result) => { if (active.current) onChange(result.compositeHash) },
    onError: (error) => { if (active.current) showSnackbar({ message: getErrorMessage(error, t({ ko: '이미지를 가져오지 못했어.', en: 'Could not import the image.' })), tone: 'error' }) },
    onSettled: () => { if (busy.current) { busy.current = false; reportBusy.current(false) } },
  })
}

/** Compact input controls shared by reference images, avatars and backgrounds. */
export function ChatProfileAssetInput({ characterName, onChange, onBusyChange, extraInputs = true, uploadRef, busy = false }: {
  characterName: string
  onChange: (hash: string) => void
  onBusyChange: (busy: boolean) => void
  extraInputs?: boolean
  busy?: boolean
  uploadRef?: RefObject<HTMLInputElement | null>
}) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const { showSnackbar } = useSnackbar()
  const localRef = useRef<HTMLInputElement>(null)
  const fileRef = uploadRef ?? localRef
  const [picker, setPicker] = useState<'library' | 'files' | null>(null)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const mutation = useChatProfileAssetImport(onChange, onBusyChange)
  const disabled = busy || mutation.isPending || !canViewImages
  // Match characterMediaGroupPath on the server.
  // eslint-disable-next-line no-control-regex
  const groupName = characterName.replace(/[/\\]/g, '-').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || '이름 없음'
  return <>
    <div className="flex items-center gap-1">
      <IconButton size="icon-sm" variant="ghost" disabled={disabled} label={t({ ko: '라이브러리에서 고르기', en: 'Choose from library' })} onClick={() => setPicker('library')}><Image /></IconButton>
      <IconButton size="icon-sm" variant="ghost" disabled={disabled} label={t({ ko: '업로드', en: 'Upload' })} onClick={() => fileRef.current?.click()}><Upload /></IconButton>
      {extraInputs ? <>
        <Popover open={urlOpen} onOpenChange={setUrlOpen}>
          <PopoverTrigger asChild><IconButton size="icon-sm" variant="ghost" disabled={disabled} label={t({ ko: 'URL로 가져오기', en: 'Import from URL' })}><Link /></IconButton></PopoverTrigger>
          <PopoverContent align="start" className="p-2">
            <form className="flex items-center gap-1" onSubmit={(event) => {
              event.preventDefault()
              if (!url.trim() || disabled) return
              mutation.mutate(() => downloadChatProfileAsset(url.trim(), characterName), { onSuccess: () => { setUrlOpen(false); setUrl('') } })
            }}>
              <Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} aria-label={t({ ko: '이미지 URL', en: 'Image URL' })} placeholder="https://" autoFocus disabled={disabled} />
              <IconButton type="submit" size="icon-sm" disabled={disabled || !url.trim()} label={t({ ko: '가져오기', en: 'Import' })}><Check /></IconButton>
            </form>
          </PopoverContent>
        </Popover>
        <IconButton size="icon-sm" variant="ghost" disabled={disabled} label={t({ ko: '파일 보관함에서 고르기', en: 'Choose from files' })} onClick={() => setPicker('files')}><Folder /></IconButton>
      </> : null}
    </div>
    <input ref={fileRef} type="file" accept={PROFILE_IMAGE_ACCEPT} className="hidden" disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file && !disabled) mutation.mutate(() => uploadChatProfileAsset(file, characterName))
    }} />
    {picker === 'library' ? <ChatMediaPicker initial={[]} maxCount={1} imagesOnly initialGroupPath={`채팅 캐릭터/${groupName}`} title={t({ ko: '이미지 고르기', en: 'Choose image' })} applyLabel={t({ ko: '선택', en: 'Select' })} note={null} onClose={() => setPicker(null)} onPick={(items) => { if (disabled) return; if (items[0]) onChange(items[0].compositeHash); setPicker(null) }} /> : null}
    {picker === 'files' ? <FilePicker accept={FILE_EXTENSIONS} title={t({ ko: '보관함 이미지 고르기', en: 'Choose stored image' })} pickLabel={() => t({ ko: '선택', en: 'Select' })} onClose={() => setPicker(null)} onPick={(items) => {
      if (disabled) return
      if (items.length !== 1) { showSnackbar({ message: t({ ko: '이미지 한 장을 골라줘.', en: 'Choose one image.' }), tone: 'error' }); return }
      setPicker(null)
      mutation.mutate(() => importChatProfileAssetFromFileStore(items[0].id, characterName))
    }} /> : null}
  </>
}
