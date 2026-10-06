import { useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookPlus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { loreEntryTitle, type ChatLoreEntry, type LoreSecondaryLogic } from '@/lib/api-codex-chat'
import { createStoredFolder, listStoredFiles, uploadStoredFiles } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'
import { CollapsibleRow } from './chat-profile-sections'

/** Where an entry's linked file lives: a global book has none; an account or chat book has its folder (null until it exists). */
export type LoreFilePlace = { kind: 'global' } | { kind: 'owned'; folderId: string | null }

/** The folder a book keeps its linked files in, and the text files the model can read (the server's list). */
const LORE_FILES_FOLDER = '자료'
const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.yaml', '.yml', '.xml', '.html', '.htm', '.svg', '.css', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.sh', '.sql', '.log', '.ini', '.toml', '.srt', '.vtt']
const UPLOAD_OPTION = '\u0000upload'

export function isLoreTextFile(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 && TEXT_EXTENSIONS.includes(name.slice(dot).toLowerCase())
}

export const loreBookFilesQueryKey = (folderId: string | null) => ['lorebook-files', folderId] as const

/** The book folder's 자료/ (null while it has none) and the files directly in it. */
async function listLoreFiles(folderId: string) {
  const book = await listStoredFiles(folderId)
  const materials = book.entries.find((entry) => entry.kind === 'folder' && entry.name === LORE_FILES_FOLDER) ?? null
  if (!materials) return { materialsId: null, files: [] }
  const listing = await listStoredFiles(materials.id)
  return { materialsId: materials.id, files: listing.entries.filter((entry) => entry.kind === 'file') }
}

/** 자료 파일: a file of the book's 자료/ (text only; others are listed as unreadable), or a text file uploaded there now. */
function LoreFileField({ place, value, onChange }: { place: LoreFilePlace; value: string | null; onChange: (file: string | null) => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const folderId = place.kind === 'owned' ? place.folderId : null
  const filesQuery = useQuery({ queryKey: loreBookFilesQueryKey(folderId), queryFn: () => listLoreFiles(folderId as string), enabled: folderId !== null })
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const materialsId = (await listLoreFiles(folderId as string)).materialsId ?? (await createStoredFolder(folderId, LORE_FILES_FOLDER)).id
      const [uploaded] = await uploadStoredFiles(materialsId, [file])
      return uploaded
    },
    onSuccess: async (uploaded) => {
      await queryClient.invalidateQueries({ queryKey: loreBookFilesQueryKey(folderId) })
      if (uploaded) onChange(`${LORE_FILES_FOLDER}/${uploaded.name}`)
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '올리지 못했어.', en: 'Could not upload.' })), tone: 'error' }),
  })

  const files = filesQuery.data?.files ?? []
  const listed = files.some((file) => `${LORE_FILES_FOLDER}/${file.name}` === value)
  const unreadable = t({ ko: '지금은 모델이 못 읽어', en: 'The model cannot read it yet' })
  const disabledTip = place.kind === 'global'
    ? t({ ko: '글로벌 로어북에는 자료를 붙일 수 없어', en: 'Global lorebooks cannot link files' })
    : folderId === null ? t({ ko: '먼저 저장해', en: 'Save first' }) : null

  return (
    <Field label={t({ ko: '자료 파일', en: 'Linked file' })}>
      <div className="flex min-w-0 items-center gap-2">
        <Tip content={disabledTip}>
          <span className="min-w-0 flex-1">
            <Select
              variant="settings"
              className="font-mono text-xs"
              value={value ?? ''}
              disabled={disabledTip !== null || uploadMutation.isPending}
              onChange={(event) => {
                if (event.target.value === UPLOAD_OPTION) inputRef.current?.click()
                else onChange(event.target.value || null)
              }}
              aria-label={t({ ko: '자료 파일', en: 'Linked file' })}
            >
              <option value="">{t({ ko: '없음', en: 'None' })}</option>
              {value && !listed ? <option value={value}>{value}</option> : null}
              {files.map((file) => {
                const text = isLoreTextFile(file.name)
                return <option key={file.id} value={`${LORE_FILES_FOLDER}/${file.name}`} disabled={!text}>{text ? `${LORE_FILES_FOLDER}/${file.name}` : `${LORE_FILES_FOLDER}/${file.name} · ${unreadable}`}</option>
              })}
              <option value={UPLOAD_OPTION}>{t({ ko: '새로 올리기…', en: 'Upload new…' })}</option>
            </Select>
          </span>
        </Tip>
        {value && !isLoreTextFile(value) ? <span className="shrink-0 text-xs text-warning">{unreadable}</span> : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={TEXT_EXTENSIONS.join(',')}
        aria-label={t({ ko: '올릴 자료 파일', en: 'File to upload' })}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) uploadMutation.mutate(file)
        }}
      />
    </Field>
  )
}

/** Keywords as chips with an input that adds one on Enter, comma or leaving it. */
function KeywordChips({ keys, onChange, addLabel }: { keys: string[]; onChange: (keys: string[]) => void; addLabel: string }) {
  const { t } = useI18n()
  const [keyword, setKeyword] = useState('')
  const addKey = () => {
    const key = keyword.trim().slice(0, 100)
    if (key && keys.length < 20 && !keys.includes(key)) onChange([...keys, key])
    setKeyword('')
  }
  return <div className="flex flex-wrap items-center gap-1.5">
    {keys.map((key) => <Chip key={key}>{key}<IconButton size="icon-xs" variant="ghost" label={t({ ko: '키워드 삭제', en: 'Remove keyword' })} onClick={() => onChange(keys.filter((value) => value !== key))}><X /></IconButton></Chip>)}
    <Input variant="settings" className="min-w-32 flex-1" maxLength={100} value={keyword} onChange={(event) => setKeyword(event.target.value)} onBlur={addKey} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter' || (event.key === ',' && !keyword.startsWith('/'))) { event.preventDefault(); addKey() }
    }} aria-label={addLabel} />
  </div>
}

/** One entry's fields, shared by the settings editor and the chat's context tab. */
export function ChatLoreEntryFields({ entry, onChange, filePlace }: { entry: ChatLoreEntry; onChange: (patch: Partial<ChatLoreEntry>) => void; filePlace: LoreFilePlace }) {
  const { t } = useI18n()
  const id = useId()
  const secondaryKeys = entry.secondaryKeys ?? []
  return <>
    <Field label={t({ ko: '제목', en: 'Title' })}>
      <Input variant="settings" value={entry.title ?? ''} maxLength={80} placeholder={loreEntryTitle({ ...entry, title: '' }) || t({ ko: '제목', en: 'Title' })} onChange={(event) => onChange({ title: event.target.value })} />
    </Field>
    <Field label={t({ ko: '키워드', en: 'Keywords' })} info={t({ ko: '/패턴/ 형태는 정규식으로 찾아.', en: '/pattern/ is matched as a regular expression.' })}>
      <KeywordChips keys={entry.keys} onChange={(keys) => onChange({ keys })} addLabel={t({ ko: '키워드 추가', en: 'Add keyword' })} />
    </Field>
    <Field label={t({ ko: '보조 키워드', en: 'Secondary keywords' })}>
      <div className="flex flex-col gap-2">
        <KeywordChips keys={secondaryKeys} onChange={(keys) => onChange({ secondaryKeys: keys })} addLabel={t({ ko: '보조 키워드 추가', en: 'Add secondary keyword' })} />
        {secondaryKeys.length > 0 ? (
          <Select variant="settings" className="w-56" value={entry.secondaryLogic ?? 'andAny'} onChange={(event) => onChange({ secondaryLogic: event.target.value as LoreSecondaryLogic })} aria-label={t({ ko: '보조 키워드 조건', en: 'Secondary keyword rule' })}>
            <option value="andAny">{t({ ko: '하나라도 있을 때', en: 'Any of them present' })}</option>
            <option value="andAll">{t({ ko: '모두 있을 때', en: 'All of them present' })}</option>
            <option value="notAny">{t({ ko: '하나도 없을 때', en: 'None of them present' })}</option>
            <option value="notAll">{t({ ko: '다 있지는 않을 때', en: 'Not all of them present' })}</option>
          </Select>
        ) : null}
      </div>
    </Field>
    <Field label={t({ ko: '내용', en: 'Content' })}>
      <Textarea variant="settings" rows={5} value={entry.content} maxLength={20000} onChange={(event) => onChange({ content: event.target.value })} />
    </Field>
    <LoreFileField place={filePlace} value={entry.file ?? null} onChange={(file) => onChange({ file, fileId: null })} />
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
      <div className="flex items-center gap-2"><Switch id={`${id}-constant`} checked={entry.constant} onCheckedChange={(constant) => onChange({ constant })} /><label htmlFor={`${id}-constant`} className="cursor-pointer">{t({ ko: '항상 넣기', en: 'Always include' })}</label></div>
      <div className="flex items-center gap-2"><Switch id={`${id}-case`} checked={entry.caseSensitive} onCheckedChange={(caseSensitive) => onChange({ caseSensitive })} /><label htmlFor={`${id}-case`} className="cursor-pointer">{t({ ko: '대소문자 구분', en: 'Case sensitive' })}</label></div>
      <Field label={t({ ko: '순서', en: 'Order' })} className="w-28"><NumberStepperInput variant="settings" min={-10000} max={10000} value={entry.order} onValueCommit={(value) => onChange({ order: Number(value) || 0 })} /></Field>
    </div>
  </>
}

/** A blank entry placed after `count` others. */
export function newLoreEntry(count: number): ChatLoreEntry {
  return { id: crypto.randomUUID(), title: '', keys: [], content: '', enabled: true, constant: false, order: count, caseSensitive: false, file: null, fileId: null }
}

export function ChatLorebookEditor({ entries, onChange, filePlace = { kind: 'global' } }: { entries: ChatLoreEntry[]; onChange: (entries: ChatLoreEntry[]) => void; filePlace?: LoreFilePlace }) {
  const { t } = useI18n()
  const [openId, setOpenId] = useState<string | null>(null)
  const update = (id: string, patch: Partial<ChatLoreEntry>) => onChange(entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))
  return <div className="space-y-2">
    {entries.map((entry) => <CollapsibleRow key={entry.id} title={loreEntryTitle(entry) || t({ ko: '새 설정', en: 'New entry' })} meta={entry.constant ? t({ ko: '항상', en: 'Always' }) : undefined} open={openId === entry.id} onOpenChange={(open) => setOpenId(open ? entry.id : null)} actions={<>
      <Switch checked={entry.enabled} onCheckedChange={(enabled) => update(entry.id, { enabled })} aria-label={t({ ko: '로어 사용', en: 'Enable lore' })} />
      <IconButton size="icon-sm" variant="ghost" label={t({ ko: '로어 삭제', en: 'Delete lore' })} onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}><Trash2 /></IconButton>
    </>}><ChatLoreEntryFields entry={entry} filePlace={filePlace} onChange={(patch) => update(entry.id, patch)} /></CollapsibleRow>)}
    <Button variant="secondary" size="sm" disabled={entries.length >= 500} onClick={() => {
      const entry = newLoreEntry(entries.length)
      onChange([...entries, entry]); setOpenId(entry.id)
    }}><BookPlus />{t({ ko: '설정 추가', en: 'Add entry' })}</Button>
  </div>
}
