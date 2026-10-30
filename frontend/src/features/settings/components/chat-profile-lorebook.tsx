import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChatProfileOptions } from '@/features/codex-chat/chat-profile-groups'
import { loreKeyLanguageTag } from '@conai/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { SwitchLine } from '@/components/ui/switch-line'
import { Textarea } from '@/components/ui/textarea'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { CHAT_STATUS_QUERY_KEY, getCodexChatStatus, loreEntryTitle, translateLoreEntry, listChatProfiles, CHAT_PROFILES_QUERY_KEY, type ChatLoreEntry, type LoreSecondaryLogic } from '@/lib/api-codex-chat'
import { createStoredFolder, listStoredFiles, uploadStoredFiles } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'
import { createRandomUuid } from '@/lib/random-uuid'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { PromptAdder } from './chat-profile-sections'

/** Where an entry's linked file lives: a global book has none; an account or chat book has its folder (null until it exists). */
export type LoreFilePlace = { kind: 'global' } | { kind: 'owned'; folderId: string | null }

/** The folder a book keeps its linked files in, and the text files the model can read (the server's list). */
const LORE_FILES_FOLDER = '자료'
export const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.yaml', '.yml', '.xml', '.html', '.htm', '.svg', '.css', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.sh', '.sql', '.log', '.ini', '.toml', '.srt', '.vtt']
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
              mono
              controlSize="compact"
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
    {keys.map((key) => <Chip key={key} removeLabel={t({ ko: '키워드 삭제', en: 'Remove keyword' })} onRemove={() => onChange(keys.filter((value) => value !== key))}>{key}</Chip>)}
    <Input variant="settings" className="min-w-32 flex-1" maxLength={100} value={keyword} onChange={(event) => setKeyword(event.target.value)} onBlur={addKey} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter' || (event.key === ',' && !keyword.startsWith('/'))) { event.preventDefault(); addKey() }
    }} aria-label={addLabel} />
  </div>
}

/**
 * With a lore key language each keyword list is two rows in one field, English and that language; without one, the
 * one list as before.
 */
function LanguageKeywordRows({ language, base, local, onBase, onLocal, addLabel }: { language: string | null; base: string[]; local: string[]; onBase: (keys: string[]) => void; onLocal: (keys: string[]) => void; addLabel: string }) {
  if (!language) return <KeywordChips keys={base} onChange={onBase} addLabel={addLabel} />
  const tag = loreKeyLanguageTag(language)
  const row = (label: string, chips: ReactNode) => <div className="flex min-w-0 items-start gap-2">
    <div className="w-7 shrink-0 pt-2.5"><Text as="span" variant="overline">{label}</Text></div>
    <div className="min-w-0 flex-1">{chips}</div>
  </div>
  return <div className="flex flex-col gap-2">
    {row('EN', <KeywordChips keys={base} onChange={onBase} addLabel={`${addLabel} (EN)`} />)}
    {row(tag, <KeywordChips keys={local} onChange={onLocal} addLabel={`${addLabel} (${tag})`} />)}
  </div>
}

/** The lore key language every book keeps its second keyword rows in (Settings › 채팅 › 자원 › 기억); null: English only. */
export function useLoreKeyLanguage() {
  const statusQuery = useQuery({ queryKey: CHAT_STATUS_QUERY_KEY, queryFn: getCodexChatStatus, staleTime: 60_000, retry: false })
  return statusQuery.data?.loreKeyLanguage ?? null
}

/** A keyword entry with English keywords and none in the lore key language. */
export function lacksLanguageKeys(entry: ChatLoreEntry, language: string | null | undefined) {
  return Boolean(language) && !entry.constant && entry.keys.some((key) => !/^\/.+\/[a-z]*$/s.test(key)) && (entry.localKeys ?? []).length === 0
}

/** One entry's fields, shared by the settings editor and the chat's context tab. `keyLanguage`: see useLoreKeyLanguage. */
export function ChatLoreEntryFields({ entry, onChange, filePlace, keyLanguage = null }: { entry: ChatLoreEntry; onChange: (patch: Partial<ChatLoreEntry>) => void; filePlace: LoreFilePlace; keyLanguage?: string | null }) {
  const { t } = useI18n()
  const [original, setOriginal] = useState(false)
  const [translator, setTranslator] = useState<number | null>(null)
  const [translationOpen, setTranslationOpen] = useState(false)
  const latest = useRef(entry); latest.current = entry
  const translationAbort = useRef<AbortController | null>(null)
  useEffect(() => () => translationAbort.current?.abort(), [])
  const { showSnackbar } = useSnackbar()
  const profilesQuery = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, enabled: translationOpen })
  const translate = useMutation({ mutationFn: async () => {
    const source = entry, key = JSON.stringify([source.id, source.title, source.keys, source.content, source.language, source.translation])
    const controller = new AbortController(); translationAbort.current = controller
    const result = await translateLoreEntry(translator!, { title: source.title ?? '', keys: source.keys, content: source.content }, controller.signal)
    controller.signal.throwIfAborted()
    if (JSON.stringify([latest.current.id, latest.current.title, latest.current.keys, latest.current.content, latest.current.language, latest.current.translation]) !== key) throw new Error(t({ ko: '번역 중 항목이 바뀌었어. 다시 시도해줘.', en: 'Entry changed while translating. Try again.' }))
    if (!result.translation) throw new Error(t({ ko: '표시용 번역을 만들지 못했어. 번역 모델과 언어 설정을 확인해줘.', en: 'No display translation. Check the translation model and languages.' }))
    onChange(result)
  }, onError: error => showSnackbar({ message: getErrorMessage(error, t({ ko: '번역하지 못했어.', en: 'Translation failed.' })), tone: 'error' }) })
  const display = !original && entry.translation ? entry.translation : entry
  const sourceChange = (patch: Partial<ChatLoreEntry>) => onChange({ ...patch, translation: null })
  const textChange = (patch: { title?: string; content?: string }) => entry.translation && !original ? onChange({ translation: { ...entry.translation, ...patch } }) : sourceChange(patch)
  const secondaryKeys = entry.secondaryKeys ?? []
  const localSecondaryKeys = entry.localSecondaryKeys ?? []
  return <>
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{t({ ko: '모델 원문', en: 'Model text' })}: {entry.language ?? t({ ko: '언어 미지정', en: 'unspecified' })}</span>
      <Button size="xs" variant="ghost" onClick={() => setTranslationOpen(!translationOpen)}>{t({ ko: '번역 만들기', en: 'Translate' })}</Button>
      {entry.translation ? <Button size="xs" variant="ghost" onClick={() => setOriginal(!original)}>{original ? t({ ko: '번역 보기', en: 'Show translation' }) : t({ ko: '원문 보기', en: 'Show original' })}</Button> : <span>{t({ ko: '표시용 번역 없음', en: 'No display translation' })}</span>}
    </div>
    {translationOpen ? <div className="flex gap-2"><Select variant="settings" value={translator ?? ''} onChange={e => setTranslator(Number(e.target.value) || null)} aria-label={t({ ko: '번역 프로필', en: 'Translation profile' })}><option value="">{t({ ko: '번역 모델이 설정된 프로필을 골라줘', en: 'Choose a profile with translation configured' })}</option><ChatProfileOptions profiles={(profilesQuery.data ?? []).filter(p => p.usable)} /></Select><Button variant="secondary" size="xs" disabled={!translator || translate.isPending} onClick={() => translate.mutate()}>{translate.isPending ? t({ ko: '번역 중', en: 'Translating' }) : t({ ko: '초안에 반영', en: 'Apply to draft' })}</Button></div> : null}
    <Field label={t({ ko: '제목', en: 'Title' })}>
      <Input variant="settings" value={display.title ?? ''} maxLength={80} placeholder={loreEntryTitle({ ...entry, title: '' }) || t({ ko: '제목', en: 'Title' })} onChange={(event) => textChange({ title: event.target.value })} />
    </Field>
    <Field label={t({ ko: '키워드', en: 'Keywords' })} info={t({ ko: '/패턴/ 형태는 정규식으로 찾아.', en: '/pattern/ is matched as a regular expression.' })}>
      {/* Local keys written before the translation still match, so they show beside its keys and fold into them on edit. */}
      <LanguageKeywordRows language={entry.translation?.language ?? keyLanguage} base={entry.keys} local={entry.translation ? [...new Set([...entry.translation.keys, ...(entry.localKeys ?? [])])] : entry.localKeys ?? []} onBase={(keys) => sourceChange({ keys })} onLocal={(localKeys) => onChange(entry.translation ? { translation: { ...entry.translation, keys: localKeys }, localKeys: [] } : { localKeys })} addLabel={t({ ko: '키워드 추가', en: 'Add keyword' })} />
    </Field>
    <Field label={t({ ko: '보조 키워드', en: 'Secondary keywords' })}>
      <div className="flex flex-col gap-2">
        <LanguageKeywordRows language={keyLanguage} base={secondaryKeys} local={localSecondaryKeys} onBase={(keys) => onChange({ secondaryKeys: keys })} onLocal={(keys) => onChange({ localSecondaryKeys: keys })} addLabel={t({ ko: '보조 키워드 추가', en: 'Add secondary keyword' })} />
        {secondaryKeys.length + localSecondaryKeys.length > 0 ? (
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
      <Textarea variant="settings" rows={5} value={display.content} maxLength={20000} onChange={(event) => textChange({ content: event.target.value })} />
    </Field>
    <LoreFileField place={filePlace} value={entry.file ?? null} onChange={(file) => onChange({ file, fileId: null })} />
    <div className="space-y-2">
      <Text as="div" variant="overline">{t({ ko: '시간 조건', en: 'Timing' })}</Text>
      <div className="grid grid-cols-4 gap-2">
        {([{ key: 'sticky', label: { ko: '유지', en: 'Sticky' } }, { key: 'cooldown', label: { ko: '쿨다운', en: 'Cooldown' } }, { key: 'delay', label: { ko: '지연', en: 'Delay' } }] as const).map(({ key, label }) => <Field key={key} label={t(label)} className="min-w-0">
          <NumberStepperInput variant="settings" min={0} max={Number.MAX_SAFE_INTEGER} precision={0} value={entry[key] ?? 0} className="min-w-0" aria-label={t(label)} onValueCommit={(value) => onChange({ [key]: Number(value) || 0 })} />
        </Field>)}
        <Field label={t({ ko: '그룹', en: 'Group' })} className="min-w-0"><Input variant="settings" value={entry.group ?? ''} maxLength={100} onChange={(event) => onChange({ group: event.target.value })} /></Field>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
      <SwitchLine placement="start" label={t({ ko: '항상 넣기', en: 'Always include' })} checked={entry.constant} onCheckedChange={(constant) => onChange({ constant })} />
      <SwitchLine placement="start" label={t({ ko: '대소문자 구분', en: 'Case sensitive' })} checked={entry.caseSensitive} onCheckedChange={(caseSensitive) => onChange({ caseSensitive })} />
      <Tip content={t({ ko: '다른 로어 내용으로는 안 걸리고, 대화에 키가 나와야만 들어가', en: 'Only the chat can bring it in, never another entry’s text' })}>
        <SwitchLine placement="start" label={t({ ko: '재귀로 안 걸림', en: 'Not by recursion' })} checked={entry.excludeRecursion === true} onCheckedChange={(excludeRecursion) => onChange({ excludeRecursion })} />
      </Tip>
      <Tip content={t({ ko: '재귀 스캔에서 이 내용 속 키워드로 다른 항목을 부를지', en: 'Whether this entry’s text brings in other entries in a recursive scan' })}>
        <SwitchLine placement="start" label={t({ ko: '다른 항목 부르기', en: 'Brings in others' })} checked={entry.preventRecursion !== true} onCheckedChange={(calls) => onChange({ preventRecursion: !calls })} />
      </Tip>
      <Field label={t({ ko: '순서', en: 'Order' })} className="w-28"><NumberStepperInput variant="settings" min={-10000} max={10000} value={entry.order} onValueCommit={(value) => onChange({ order: Number(value) || 0 })} /></Field>
    </div>
  </>
}

/** A blank entry placed after `count` others. */
export function newLoreEntry(count: number): ChatLoreEntry {
  return { id: createRandomUuid(), title: '', keys: [], content: '', enabled: true, constant: false, order: count, caseSensitive: false, file: null, fileId: null }
}

export function ChatLorebookEditor({ entries, onChange, filePlace = { kind: 'global' }, keyLanguage = null }: { entries: ChatLoreEntry[]; onChange: (entries: ChatLoreEntry[]) => void; filePlace?: LoreFilePlace; keyLanguage?: string | null }) {
  const { t } = useI18n()
  const kind = filePlace.kind
  const folderId = filePlace.kind === 'owned' ? filePlace.folderId : null
  const place: LoreFilePlace = kind === 'global' ? { kind: 'global' } : { kind: 'owned', folderId }
  const [openId, setOpenId] = useState<string | null>(null)
  const current = useRef({ entries, onChange })
  useLayoutEffect(() => { current.current = { entries, onChange } }, [entries, onChange])
  const update = (id: string, patch: Partial<ChatLoreEntry>) => {
    const { entries, onChange } = current.current
    onChange(entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))
  }
  const remove = (id: string) => {
    const { entries, onChange } = current.current
    onChange(entries.filter((entry) => entry.id !== id))
  }
  return <div className="space-y-2">
    {entries.map((entry) => <LoreEntryRow key={entry.id} entry={entry} open={openId === entry.id} onOpen={setOpenId} onUpdate={update} onRemove={remove} filePlace={place} keyLanguage={keyLanguage} />)}
    {entries.length ? null : <EmptyState size="compact" icon={BookOpen} title={t({ ko: '아직 항목이 없어', en: 'No entries yet' })} />}
    <PromptAdder label={t({ ko: '항목 추가', en: 'Add entry' })} disabled={entries.length >= 500} onAdd={() => {
      const entry = newLoreEntry(entries.length)
      onChange([...entries, entry]); setOpenId(entry.id)
    }} />
  </div>
}

function LoreEntryRow({ entry, open, onOpen, onUpdate, onRemove, filePlace, keyLanguage }: {
  entry: ChatLoreEntry; open: boolean; onOpen: (id: string | null) => void
  onUpdate: (id: string, patch: Partial<ChatLoreEntry>) => void; onRemove: (id: string) => void
  filePlace: LoreFilePlace; keyLanguage: string | null
}) {
  const { t } = useI18n()
  const missing = keyLanguage ? t({ ko: '{tag} 없음', en: 'No {tag}' }, { tag: loreKeyLanguageTag(keyLanguage) }) : ''
  return <CollapsibleRow title={loreEntryTitle(entry) || t({ ko: '새 설정', en: 'New entry' })} meta={entry.constant ? t({ ko: '항상', en: 'Always' }) : lacksLanguageKeys(entry, keyLanguage) ? <span className="font-semibold text-warning">{missing}</span> : undefined} open={open} onOpenChange={(open) => onOpen(open ? entry.id : null)} actions={<>
    <Switch checked={entry.enabled} onCheckedChange={(enabled) => onUpdate(entry.id, { enabled })} aria-label={t({ ko: '로어 사용', en: 'Enable lore' })} />
    <IconButton size="icon-sm" variant="ghost" label={t({ ko: '로어 삭제', en: 'Delete lore' })} onClick={() => onRemove(entry.id)}><Trash2 /></IconButton>
  </>}><ChatLoreEntryFields entry={entry} filePlace={filePlace} keyLanguage={keyLanguage} onChange={(patch) => onUpdate(entry.id, patch)} /></CollapsibleRow>
}
