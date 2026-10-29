import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { File } from 'lucide-react'
import { FieldTabs } from '@/components/common/field-tabs'
import { SaveConflictAlert, SaveConflictOverwriteButton } from '@/components/common/save-conflict-alert'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageFreeText, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { useI18n } from '@/i18n'
import { ApiRequestError } from '@/lib/api-request'
import { getErrorMessage } from '@/lib/error-message'
import { replaceExactText, type ExactTextEdit } from '@/lib/exact-text-edits'

const ChatMarkdown = lazy(() => import('@/features/codex-chat/chat-markdown').then((module) => ({ default: module.ChatMarkdown })))
const PlainTextEditor = lazy(() => import('@/components/common/plain-text-editor').then((module) => ({ default: module.PlainTextEditor })))
const PostRichEditor = lazy(() => import('@/features/posts/post-rich-editor').then((module) => ({ default: module.PostRichEditor })))

type DocumentFormat = 'md' | 'txt'
type MarkdownTab = 'write' | 'source' | 'preview'
/**
 * The document text the connected chat sees with every request: a document up to this long is a field, a longer one
 * a chunk of this size (files.doc_at moves it) changed with files.doc_edit.
 */
const DOCUMENT_CHUNK = 2000
const isMarkdownName = (name: string) => /\.(md|markdown)$/i.test(name)

/** A document the editor can open: `id` is stable per store (file id, project path), `name` the file name. */
export type TextDocument = { id: string; name: string }

/** Where a document lives: the file store or a project workspace. */
export type TextDocumentStore<T extends TextDocument> = {
  /** Separates cached loads of different stores. */
  key: string
  /** `tooLarge`: the document grew past what this store edits in one piece since the list was read. */
  load: (document: T) => Promise<{ text: string; revision: string | null } | { tooLarge: true }>
  /** Existing document (`document` set) or a new one named `fileName` in the open folder. */
  save: (document: T | null, text: string, revision: string | null, fileName: string) => Promise<{ document: T; revision: string | null }>
  /** After a save: refresh the lists that show this store. */
  refresh: () => Promise<unknown>
  /** Too big to edit here (shown instead of the editor). */
  tooLarge?: (document: T) => boolean
  tooLargeTitle?: string
  /** Muted text at the start of the footer (where the document is). */
  location?: ReactNode
}

/**
 * A plain text / Markdown document: a new one (`entry` null) or an existing one, in any store. Saving keeps the
 * editor open (a new document becomes that file); `onClose` gets the document as last saved, or null when nothing was.
 * `chatPage`: the page is connected to a chat, so the open document joins that connection (see below).
 */
export function TextDocumentEditor<T extends TextDocument>({ entry, store, onClose, chatPage = false }: {
  entry: T | null
  store: TextDocumentStore<T>
  onClose: (saved: T | null) => void
  chatPage?: boolean
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const [file, setFile] = useState(entry)
  const [saved, setSaved] = useState<T | null>(null)
  const [name, setName] = useState(() => t({ ko: '새 문서', en: 'New document' }))
  const [format, setFormat] = useState<DocumentFormat>('md')
  const [text, setText] = useState(entry ? null as string | null : '')
  const [baseline, setBaseline] = useState(entry ? null as string | null : '')
  const [revision, setRevision] = useState<string | null>(null)
  const [tab, setTab] = useState<MarkdownTab>('write')
  // Someone else saved this document since it was opened: the person picks reload or overwrite.
  const [conflict, setConflict] = useState(false)
  const listedTooLarge = entry !== null && store.tooLarge?.(entry) === true
  const source = useQuery({
    queryKey: ['text-document-editor', store.key, entry?.id],
    queryFn: () => store.load(entry!),
    enabled: entry !== null && !listedTooLarge,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const tooLarge = listedTooLarge || (source.data !== undefined && 'tooLarge' in source.data)
  useEffect(() => {
    if (source.data !== undefined && !('tooLarge' in source.data) && text === null) {
      setText(source.data.text)
      setBaseline(source.data.text)
      setRevision(source.data.revision)
    }
  }, [source.data, text])

  // A typed .txt / .md wins over the switch, so "notes.md" never becomes "notes.md.txt".
  const fileName = /\.(txt|md|markdown)$/i.test(name.trim()) ? name.trim() : `${name.trim()}.${format}`
  const markdown = isMarkdownName(file?.name ?? fileName)
  const dirty = file ? text !== null && text !== baseline : true
  const save = useMutation({
    mutationFn: ({ value, base }: { value: string; base?: string | null }) => store.save(file, value, base === undefined ? revision : base, fileName),
    onSuccess: async (result, { value }) => {
      setFile(result.document)
      setSaved(result.document)
      setBaseline(value)
      setRevision(result.revision)
      setConflict(false)
      await store.refresh()
    },
    onError: (error) => {
      if (file && error instanceof ApiRequestError && error.status === 409) { setConflict(true); return }
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '문서를 저장하지 못했어.', en: 'Could not save the document.' })) })
    },
  })
  /** The saved version replaces the draft (after a confirm, since the draft is lost). */
  const reloadLatest = async () => {
    if (dirty && !(await confirm({ title: t({ ko: '고친 내용을 버리고 최신본을 불러올까?', en: 'Discard your edits and load the latest version?' }), confirmLabel: t({ ko: '불러오기', en: 'Load' }), tone: 'destructive' }))) return
    setConflict(false)
    setText(null)
    setBaseline(null)
    await source.refetch()
  }
  /** The draft is saved over the newer version: take its revision, then save as usual. */
  const overwrite = async () => {
    if (!file || text === null) return
    const latest = await store.load(file).catch((error: unknown) => { showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '최신본을 확인하지 못했어.', en: 'Could not check the latest version.' })) }); return null })
    if (!latest) return
    if ('tooLarge' in latest) { setConflict(false); showSnackbar({ tone: 'error', message: store.tooLargeTitle ?? t({ ko: '너무 큰 파일은 여기서 편집할 수 없어', en: 'This file is too large to edit here' }) }); return }
    save.mutate({ value: text, base: latest.revision })
  }
  const canSave = text !== null && !save.isPending && (file ? dirty : name.trim() !== '')
  const submit = () => { if (canSave && text !== null) save.mutate({ value: text }) }

  // The connected chat reads and drafts the document opened here; that draft leaves the page context on close.
  // The file browser does not attach unopened document bodies. Existing file-tool grants remain available;
  // saving still goes through a review card.
  const [chunkOffset, setChunkOffset] = useState(0)
  const commitText = useChatDraftTransaction(text ?? '', setText)
  const textFits = text !== null && text.length <= DOCUMENT_CHUNK
  useChatPageRegistration(chatPage && !save.isPending ? {
    kind: 'files',
    title: file ? file.name : t({ ko: '새 문서', en: 'New document' }),
    resourceId: `document:${store.key}:${file?.id ?? 'new'}`,
    priority: 1,
    dirty: dirty && (file !== null || text !== ''),
    fields: [
      ...(file ? [] : [
        { id: 'documentName', label: t({ ko: '새 문서 이름', en: 'New document name' }), type: 'text' as const, value: name },
        { id: 'documentFormat', label: t({ ko: '형식', en: 'Format' }), type: 'select' as const, value: format, options: ['md', 'txt'] },
      ]),
      ...(textFits ? [{ id: 'content', label: t({ ko: '문서 내용', en: 'Document text' }), type: 'text' as const, value: text, allowEmpty: true }] : []),
    ],
    data: {
      document: {
        name: file ? file.name : fileName, markdown, length: text?.length ?? 0, saved: file !== null && !dirty,
        ...(tooLarge ? { tooLarge: true } : {}),
        ...(text !== null && !textFits ? { offset: chunkOffset, text: pageFreeText(text.slice(chunkOffset, chunkOffset + DOCUMENT_CHUNK)) } : {}),
      },
    },
    actions: text === null ? [] : [
      ...(textFits ? [] : [pageAction('files.doc_at', t({ ko: '문서 이어 읽기', en: 'Read the document from' }), t({ ko: 'data.document.text를 offset부터 보여줘', en: 'data.document.text from offset' }), pageObject({ offset: pageNumber(0, Math.max(0, text.length - 1), true) }, ['offset']))]),
      pageAction('files.doc_edit', t({ ko: '문서 고치기', en: 'Edit the document' }), t({ ko: 'whole은 전체를 바꿔. edits는 find(한 번만 나오는 글)를 replace로 차례로 바꾸고, 하나라도 안 맞으면 그대로야', en: 'whole replaces the text; edits replace each find (appearing once) in order, all or nothing' }), pageObject({ whole: pageText(200000), edits: pageArray(pageObject({ find: pageText(8000), replace: pageText(100000), all: { type: 'boolean' } }, ['find', 'replace']), 50) })),
      pageAction('files.doc_append', t({ ko: '문서 끝에 이어 쓰기', en: 'Append to the document' }), '', pageObject({ text: pageText(100000) }, ['text'])),
      ...(canSave ? [pageAction('files.doc_save', file ? t({ ko: '문서 저장', en: 'Save document' }) : t({ ko: '새 문서 만들기', en: 'Create document' }), '', undefined, 'save')] : []),
    ],
    apply: (patch) => {
      if (typeof patch.documentName === 'string' && !file) setName(patch.documentName)
      if ((patch.documentFormat === 'md' || patch.documentFormat === 'txt') && !file) setFormat(patch.documentFormat)
      if (typeof patch.content === 'string' && text !== null) { setText(patch.content); if (tab === 'preview') setTab('write') }
    },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (text === null) throw new Error('문서를 아직 불러오는 중이야.')
      if (id === 'files.doc_at') { setChunkOffset(Number(args.offset)); return }
      if (id === 'files.doc_edit') return commitText(typeof args.whole === 'string' ? args.whole : replaceExactText(text, (Array.isArray(args.edits) ? args.edits : []) as ExactTextEdit[], '문서'))
      if (id === 'files.doc_append') return commitText(text + String(args.text))
      if (id !== 'files.doc_save') throw new Error('문서 편집기에 없는 작업이야.')
      if (!canSave) throw new Error('저장할 내용이 없어.')
      await save.mutateAsync({ value: text })
    },
  } : null)

  let content
  if (tooLarge) content = <EmptyState icon={File} title={store.tooLargeTitle ?? t({ ko: '너무 큰 파일은 여기서 편집할 수 없어', en: 'This file is too large to edit here' })} />
  else if (source.isError) content = <ErrorState title={t({ ko: '파일을 열지 못했어.', en: 'Could not open the file.' })} error={source.error} onRetry={() => void source.refetch()} />
  else if (text === null) content = <LoadingState />
  else if (!markdown) content = <Suspense fallback={<LoadingState />}><PlainTextEditor value={text} onChange={setText} autoFocus={file !== null} fileName={file?.name ?? fileName} /></Suspense>
  else content = (
    // Markdown: the same in-place tabs as the post editor, in one frame. The visual editor keeps the text Markdown.
    <div className="theme-input-surface min-w-0 overflow-hidden rounded-sm border">
      <FieldTabs
        value={tab}
        onChange={setTab}
        ariaLabel={t({ ko: '편집 방식', en: 'Editing mode' })}
        bare
        items={[{ value: 'write', label: t({ ko: '서식 편집', en: 'Visual' }) }, { value: 'source', label: t({ ko: '원문', en: 'Source' }) }, { value: 'preview', label: t({ ko: '미리보기', en: 'Preview' }) }]}
      />
      <div className="border-t border-line">
        <Suspense fallback={<div className="h-[55vh]"><LoadingState /></div>}>
          {tab === 'write' ? (
            <PostRichEditor
              value={text}
              onChange={setText}
              autoFocus={file !== null}
              bodyClassName="h-[55vh] min-h-0 overflow-y-auto"
              onError={(error) => {
                setTab('source')
                showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '서식 편집기를 열지 못했어. 원문에서 계속 편집할 수 있어.', en: 'Could not open the visual editor. You can continue editing the source.' })) })
              }}
              onUnsupportedUpload={() => showSnackbar({ tone: 'info', message: t({ ko: '여기선 이미지를 붙여 넣을 수 없어. 원문에 링크로 넣어줘.', en: 'Images cannot be pasted here. Add them as links in the source.' }) })}
            />
          ) : tab === 'source' ? (
            <PlainTextEditor value={text} onChange={setText} autoFocus={file !== null} fileName="document.md" bare />
          ) : (
            <div className="h-[55vh] overflow-auto p-4"><ChatMarkdown text={text} /></div>
          )}
        </Suspense>
      </div>
    </div>
  )

  return (
    <Modal open title={file ? file.name : t({ ko: '새 문서', en: 'New document' })} onClose={() => onClose(saved)} size="xl" dirty={dirty && (file !== null || text !== '')} onSave={canSave ? submit : undefined}>
      <ModalBody spacing="sm">
        {file ? null : (
          <div className="flex items-center gap-2">
            <Input variant="settings" autoFocus className="min-w-0 flex-1" aria-label={t({ ko: '파일 이름', en: 'File name' })} value={name} onChange={(event) => setName(event.target.value)} />
            <SegmentedControl
              size="sm"
              value={format}
              onChange={(value) => setFormat(value === 'txt' ? 'txt' : 'md')}
              ariaLabel={t({ ko: '형식', en: 'Format' })}
              items={[{ value: 'md', label: 'MD', ariaLabel: 'Markdown' }, { value: 'txt', label: 'TXT', ariaLabel: t({ ko: '텍스트', en: 'Plain text' }) }]}
            />
          </div>
        )}
        {conflict ? (
          <SaveConflictAlert message={t({ ko: '다른 곳에서 이 문서가 바뀌었어.', en: 'This document was changed elsewhere.' })}>
            <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => void reloadLatest()}>{t({ ko: '최신본 불러오기', en: 'Load latest' })}</Button>
            <SaveConflictOverwriteButton disabled={save.isPending} onClick={() => void overwrite()} />
          </SaveConflictAlert>
        ) : null}
        {content}
      </ModalBody>
      <ModalFooter>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{store.location}</span>
        <Button disabled={!canSave} onClick={submit}>{t({ ko: '저장', en: 'Save' })}</Button>
      </ModalFooter>
    </Modal>
  )
}
