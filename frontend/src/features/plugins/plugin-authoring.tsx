import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Code, FilePlus, Plus, RefreshCw, Upload } from 'lucide-react'
import type { ChatPageAction, ChatPageData, PluginDraft, PluginPackageReview } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { EditorFooter } from '@/components/ui/editor-footer'
import { IconButton } from '@/components/ui/icon-button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { RowGroup } from '@/components/ui/row-group'
import { ResourceRow } from '@/components/ui/resource-row'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageFreeText, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { CHAT_DOCK_INSET } from '@/features/settings/components/use-settings-editor-chat-page'
import { useI18n } from '@/i18n'
import { createRandomUuid } from '@/lib/random-uuid'
import { getErrorMessage } from '@/lib/error-message'
import { PLUGINS_QUERY_KEY } from '@/lib/api-plugins'
import { changePluginDraft, type PluginDraftChange, createPluginDraft, deletePluginDraft, downloadPluginPackage, getPluginDraft, installPluginDraft, listPluginDrafts, PLUGIN_DRAFTS_QUERY_KEY, pluginDraftQueryKey, readPluginDraft, reviewPluginDraft, uploadPluginDraftAsset } from '@/lib/api-plugin-authoring'
import { PluginPackageReviewSummary } from './plugin-package-review-summary'

/** How much of the open file the page data carries; plugin_author.at moves the window. */
const EXCERPT_CHARS = 8000

const PlainTextEditorLazy = lazy(() => import('@/components/common/plain-text-editor').then((module) => ({ default: module.PlainTextEditor })))

/** Plugin management's own assistant data and actions. A page has one active registration, so the drafts list carries them. */
export type PluginManagementPage = {
  localRevision: string; data: Record<string, ChatPageData>; actions: ChatPageAction[]
  applyAction: (id: string, args: Record<string, ChatPageData>) => Promise<void>
}

/** This list also lives on the 플러그인 page (/extensions), where the `settings` kind (bound to /settings) doesn't apply. */
function usePluginPageKind() {
  return useLocation().pathname === '/settings' ? 'settings' as const : 'page' as const
}

export function PluginAuthoring({ page }: { page?: PluginManagementPage }) {
  const { t } = useI18n()
  const kind = usePluginPageKind()
  const cache = useQueryClient()
  const [params, setParams] = useSearchParams()
  const selected = params.get('draft')
  const drafts = useQuery({ queryKey: PLUGIN_DRAFTS_QUERY_KEY, queryFn: listPluginDrafts })
  const draft = useQuery({ queryKey: pluginDraftQueryKey(selected), queryFn: () => getPluginDraft(selected!), enabled: !!selected })
  const [creating, setCreating] = useState(false)
  const [pluginId, setPluginId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const open = (id: string | null) => setParams(previous => { const next = new URLSearchParams(previous); if (id) next.set('draft', id); else next.delete('draft'); return next })
  const create = async (id: string, label: string, fromInstalled = false) => {
    const created = await createPluginDraft({ requestId: createRandomUuid(), pluginId: id, name: label || id, fromInstalled })
    await cache.invalidateQueries({ queryKey: PLUGIN_DRAFTS_QUERY_KEY })
    setCreating(false); open(created.id)
  }
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await operation() } catch (reason) { setError(getErrorMessage(reason, t({ ko: '플러그인 작업에 실패했어.', en: 'Plugin operation failed.' }))) } finally { setBusy(false) }
  }
  useChatPageRegistration(!selected ? {
    kind, title: t({ ko: '플러그인 관리', en: 'Plugin management' }), resourceId: 'plugin-authoring', priority: 15, localRevision: page?.localRevision,
    fields: [], data: { drafts: (drafts.data ?? []).map(item => ({ id: item.id, pluginId: item.pluginId, name: item.name, revision: item.revision })), ...page?.data }, apply: () => {},
    actions: [
      pageAction('plugin_author.open', t({ ko: '초안 열기', en: 'Open draft' }), '', pageObject({ draftId: pageText(32) }, ['draftId'])),
      pageAction('plugin_author.create', t({ ko: '플러그인 초안 만들기', en: 'Create plugin draft' }), 'Create an inactive draft. fromInstalled copies an installed package without its private data.', pageObject({ pluginId: pageText(48), name: pageText(100), fromInstalled: { type: 'boolean' } }, ['pluginId']), 'save'),
      pageAction('plugin_author.refresh', t({ ko: '새로고침', en: 'Refresh' }), ''),
      ...(page?.actions ?? []),
    ],
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (page?.actions.some((action) => action.id === id)) await page.applyAction(id, args)
      else if (id === 'plugin_author.open') open(String(args.draftId))
      else if (id === 'plugin_author.create') await create(String(args.pluginId), String(args.name ?? args.pluginId), args.fromInstalled === true)
      else await drafts.refetch()
    },
  } : null)
  return <>
    <RowGroup heading={t({ ko: '제작 중인 플러그인', en: 'Plugin drafts' })} count={drafts.data?.length} actions={<>
      <IconButton variant="ghost" size="icon-sm" label={t({ ko: '초안 새로고침', en: 'Refresh drafts' })} onClick={() => void drafts.refetch()}><RefreshCw /></IconButton>
      <IconButton size="icon-sm" label={t({ ko: '새 플러그인', en: 'New plugin' })} onClick={() => setCreating(true)}><Plus /></IconButton>
    </>}>
      {error || drafts.error ? <p role="alert" className="text-sm text-destructive">{error || getErrorMessage(drafts.error, t({ ko: '초안을 읽지 못했어.', en: 'Could not load drafts.' }))}</p> : null}
      {drafts.isSuccess && drafts.data.length === 0 ? <EmptyState size="compact" icon={Code} title={t({ ko: '제작 중인 플러그인이 없어', en: 'No plugin drafts' })} /> : null}
      {drafts.data?.map(item => <ResourceRow key={item.id} leading={<Code />} name={item.name} aside={<span className="text-xs text-muted-foreground">{item.pluginId} · r{item.revision}</span>} onOpen={() => open(item.id)} />)}
    </RowGroup>
    <Modal open={creating} onClose={() => setCreating(false)} title={t({ ko: '새 플러그인', en: 'New plugin' })} size="md">
      <ModalBody spacing="sm">
        <Input aria-label={t({ ko: '플러그인 ID', en: 'Plugin ID' })} placeholder="my-plugin" value={pluginId} onChange={event => setPluginId(event.target.value)} />
        <Input aria-label={t({ ko: '플러그인 이름', en: 'Plugin name' })} placeholder={t({ ko: '플러그인 이름', en: 'Plugin name' })} value={name} onChange={event => setName(event.target.value)} />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </ModalBody>
      <EditorFooter canSave={Boolean(pluginId)} saving={busy} onSave={() => void run(() => create(pluginId, name))} saveLabel={t({ ko: '만들기', en: 'Create' })} />
    </Modal>
    {selected && draft.data ? <PluginDraftEditor key={selected} initial={draft.data} remoteRevision={draft.data.revision} onClose={() => open(null)} /> : null}
    {selected && draft.error ? <p role="alert" className="text-sm text-destructive">{getErrorMessage(draft.error, t({ ko: '초안을 읽지 못했어.', en: 'Could not load draft.' }))} <Button variant="ghost" onClick={() => open(null)}>{t({ ko: '닫기', en: 'Close' })}</Button></p> : null}
  </>
}

function PluginDraftEditor({ initial, remoteRevision, onClose }: { initial: PluginDraft; remoteRevision: number; onClose: () => void }) {
  const { t } = useI18n()
  const pageKind = usePluginPageKind()
  const cache = useQueryClient()
  const confirm = useConfirm()
  const [draft, setDraft] = useState(initial)
  const [document, setDocument] = useState<{ target: string; text: string; saved: string; revision: number } | null>(null)
  const [selectedFile, setSelectedFile] = useState('plugin.json')
  const [newTarget, setNewTarget] = useState('')
  const [review, setReview] = useState<PluginPackageReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [textRevision, setTextRevision] = useState(0)
  const [chunkOffset, setChunkOffset] = useState(0)
  const sequence = useRef(0)
  const uploadInput = useRef<HTMLInputElement>(null)
  const currentText = useRef(document)
  currentText.current = document
  const dirty = document !== null && document.text !== document.saved
  const changedElsewhere = remoteRevision > draft.revision
  const busyRef = useRef(busy)
  busyRef.current = busy
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: PLUGIN_DRAFTS_QUERY_KEY })
    await cache.invalidateQueries({ queryKey: pluginDraftQueryKey(initial.id) })
  }
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(''); setMessage('')
    try { await operation() } catch (reason) { setError(getErrorMessage(reason, t({ ko: '플러그인 작업에 실패했어.', en: 'Plugin operation failed.' }))) } finally { setBusy(false) }
  }
  const requireSaved = () => { if (dirty) throw new Error(t({ ko: '편집한 파일을 먼저 저장해줘.', en: 'Save the edited file first.' })) }
  const load = async (target: string, active: () => boolean = () => true) => {
    requireSaved()
    const request = ++sequence.current
    const previous = currentText.current
    const latest = await getPluginDraft(initial.id)
    if (!active() || sequence.current !== request || currentText.current !== previous) return
    if (!latest.files.find(file => file.name === target)?.editable) { setDraft(latest); setSelectedFile(target); setDocument(null); setReview(null); setChunkOffset(0); return }
    let text = '', offset: number | null = 0
    while (offset !== null) {
      const part = await readPluginDraft(initial.id, target, latest.revision, offset)
      text += part.text; offset = part.nextOffset
    }
    if (!active() || sequence.current !== request || currentText.current !== previous) return
    setDraft(latest); setSelectedFile(target); setDocument({ target, text, saved: text, revision: latest.revision }); setReview(null); setChunkOffset(0)
  }
  useEffect(() => {
    let active = true
    void run(() => load('plugin.json', () => active))
    return () => { active = false }
    // A new editor mounts for each draft; subsequent reads are explicit and preserve unsaved text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // A change saved elsewhere (the assistant, another tab) is followed while nothing here is unsaved; unsaved text is never replaced.
  useEffect(() => {
    if (!changedElsewhere || dirty || busy) return
    void run(() => load(currentText.current?.target ?? 'plugin.json'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedElsewhere, dirty, busy])
  /** The assistant's edits save straight into the inactive draft (revision-checked) and open the changed file. */
  const assistantChange = async (operation: PluginDraftChange) => {
    if (busyRef.current) throw new Error(t({ ko: '진행 중인 작업이 끝나면 다시 요청해줘.', en: 'Wait for the current operation to finish.' }))
    if (dirty) throw new Error(t({ ko: '사용자가 편집하고 저장하지 않은 내용이 있어. 사용자가 저장하거나 되돌린 뒤 다시 해.', en: 'The person has unsaved edits. Ask them to save or discard first.' }))
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await changePluginDraft(draft.id, draft.revision, createRandomUuid(), [operation])
      setDraft(result); setReview(null)
      await load(operation.target)
      await refresh()
    } finally { setBusy(false) }
  }
  const changeText = (text: string) => {
    setDocument(previous => previous ? { ...previous, text } : null)
    setTextRevision(previous => previous + 1); setReview(null)
  }
  const save = async () => {
    if (!document) return
    const before = document
    const result = await changePluginDraft(draft.id, before.revision, createRandomUuid(), [{ kind: 'write', target: before.target, text: before.text }])
    setDraft(result)
    setDocument(current => current?.target === before.target ? { ...current, saved: before.text, revision: result.revision } : current)
    setReview(null); await refresh()
  }
  const prepare = async () => {
    requireSaved()
    const result = await reviewPluginDraft(draft.id, draft.revision)
    setReview(result)
  }
  const install = async () => {
    requireSaved()
    if (!review || review.revision !== draft.revision) throw new Error(t({ ko: '먼저 패키지를 검토해줘.', en: 'Review the package first.' }))
    const result = await installPluginDraft(review)
    setReview(null)
    setMessage(result.enabled ? t({ ko: '플러그인을 업데이트했어. 페이지를 다시 열어줘.', en: 'Plugin updated. Reopen its page.' }) : t({ ko: '설치했어. 플러그인 목록에서 켜면 사용할 수 있어.', en: 'Installed. Enable it in the plugin list to use it.' }))
    await cache.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY }); await refresh()
    setDraft(await getPluginDraft(draft.id))
  }
  const download = async () => { requireSaved(); await downloadPluginPackage(`${draft.pluginId}.zip`, { draftId: draft.id, revision: draft.revision }) }
  const addFile = async () => {
    requireSaved()
    if (draft.files.some(file => file.name.toLowerCase() === newTarget.toLowerCase())) throw new Error(t({ ko: '같은 이름의 파일이 있어.', en: 'A file with that name exists.' }))
    setDraft(await changePluginDraft(draft.id, draft.revision, createRandomUuid(), [{ kind: 'write', target: newTarget, text: '' }]))
    await load(newTarget); setNewTarget(''); await refresh()
  }
  const removeFile = async () => {
    requireSaved()
    if (!selectedFile || !await confirm({ title: t({ ko: '초안 파일 삭제', en: 'Delete draft file' }), description: selectedFile, confirmLabel: t({ ko: '삭제', en: 'Delete' }), tone: 'destructive' })) return
    setDraft(await changePluginDraft(draft.id, draft.revision, createRandomUuid(), [{ kind: 'delete', target: selectedFile }]))
    setDocument(null); setSelectedFile(''); setReview(null); await refresh()
  }
  const renameFile = async () => {
    requireSaved()
    setDraft(await changePluginDraft(draft.id, draft.revision, createRandomUuid(), [{ kind: 'move', target: selectedFile, destination: newTarget }]))
    await load(newTarget); setNewTarget(''); await refresh()
  }
  const upload = async (file: File) => {
    requireSaved()
    const target = newTarget || file.name
    const exists = draft.files.some(item => item.name.toLowerCase() === target.toLowerCase())
    if (exists && !await confirm({ title: t({ ko: '초안 파일 교체', en: 'Replace draft file' }), description: target, confirmLabel: t({ ko: '교체', en: 'Replace' }) })) return
    setDraft(await uploadPluginDraftAsset(draft.id, draft.revision, createRandomUuid(), target, file, exists))
    await load(target); setNewTarget(''); await refresh()
  }
  const removeDraft = async () => {
    if (!await confirm({ title: t({ ko: '제작 초안 삭제', en: 'Delete source draft' }), description: t({ ko: '이 초안의 소스 파일을 지워. 설치된 플러그인은 그대로 유지돼.', en: 'Deletes these draft source files. The installed plugin is kept.' }), confirmLabel: t({ ko: '삭제', en: 'Delete' }), tone: 'destructive' })) return
    await deletePluginDraft(draft.id, draft.revision); await refresh(); onClose()
  }
  useChatPageRegistration({
    kind: pageKind, title: t({ ko: '플러그인 소스 편집', en: 'Plugin source editor' }), resourceId: draft.id, priority: 30, dirty,
    localRevision: `${draft.revision}:${textRevision}:${busy}`, fields: [],
    data: { draftId: draft.id, pluginId: draft.pluginId, revision: draft.revision, fileCount: draft.files.length, files: draft.files.slice(0, 80).map(file => ({ ...file })),
      selected: document ? { target: document.target, revision: document.revision, offset: chunkOffset, excerpt: pageFreeText(document.text.slice(chunkOffset, chunkOffset + EXCERPT_CHARS)), chars: document.text.length, unsaved: dirty } : null,
      review: review ? { revision: review.revision, digest: review.digest, version: review.version, server: review.server, conflict: review.conflict, files: review.files.filter(file => file.change !== 'unchanged').slice(0, 80).map(file => ({ ...file })) } : null,
      result: message, stale: changedElsewhere && dirty,
    }, apply: () => {},
    actions: [
      pageAction('plugin_author.file', t({ ko: '파일 열기', en: 'Open file' }), 'Show a draft file in the editor and in selected.excerpt.', pageObject({ target: pageText(200) }, ['target'])),
      ...(document && document.text.length > EXCERPT_CHARS ? [pageAction('plugin_author.at', t({ ko: '파일 이어 읽기', en: 'Read file from' }), 'selected.excerpt from offset', pageObject({ offset: pageNumber(0, Math.max(0, document.text.length - 1), true) }, ['offset']))] : []),
      pageAction('plugin_author.edit', t({ ko: '소스 수정', en: 'Edit source' }), 'Replace exact fragments of one draft text file and save it now; each before must match once. The draft is inactive until a reviewed install.', pageObject({ target: pageText(200), edits: pageArray(pageObject({ before: pageText(), after: pageText(16000) }, ['before', 'after']), 50, 1) }, ['target', 'edits']), 'save'),
      pageAction('plugin_author.write', t({ ko: '파일 쓰기', en: 'Write file' }), 'Create or replace a whole draft text file and save it now.', pageObject({ target: pageText(200), text: pageText(120000) }, ['target', 'text']), 'save'),
      ...(dirty ? [pageAction('plugin_author.save', t({ ko: '초안 파일 저장', en: 'Save draft file' }), "Save the person's unsaved edits in the open file.", undefined, 'save')] : []),
      pageAction('plugin_author.review', t({ ko: '패키지 검토', en: 'Review package' }), 'Validate saved sources and show changes against what is installed now. Does not execute code.'),
      ...(review ? [pageAction('plugin_author.install', t({ ko: '검토한 패키지 적용', en: 'Apply reviewed package' }), 'Install exactly the displayed review, replacing what is installed now (review.conflict). A new package stays disabled; an enabled update restarts its code.', undefined, 'save')] : []),
      pageAction('plugin_author.export', t({ ko: 'ZIP 내보내기', en: 'Export ZIP' }), ''),
      pageAction('plugin_author.refresh', t({ ko: '최신 소스 읽기', en: 'Reload source' }), ''),
    ],
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (busy) throw new Error(t({ ko: '진행 중인 작업이 끝나면 다시 요청해줘.', en: 'Wait for the current operation to finish.' }))
      if (id === 'plugin_author.edit') {
        const edits = (Array.isArray(args.edits) ? args.edits : []).map(item => item && typeof item === 'object' && !Array.isArray(item) ? { old_text: String(item.before ?? ''), new_text: String(item.after ?? '') } : { old_text: '', new_text: '' })
        await assistantChange({ kind: 'edit', target: String(args.target), edits })
      } else if (id === 'plugin_author.write') await assistantChange({ kind: 'write', target: String(args.target), text: String(args.text) })
      else if (id === 'plugin_author.at') setChunkOffset(Math.max(0, Math.min(Number(args.offset) || 0, Math.max(0, (document?.text.length ?? 1) - 1))))
      else if (id === 'plugin_author.file') await load(String(args.target))
      else if (id === 'plugin_author.save') await save()
      else if (id === 'plugin_author.review') await prepare()
      else if (id === 'plugin_author.install') await install()
      else if (id === 'plugin_author.export') await download()
      else await load(document?.target ?? 'plugin.json')
    },
  })
  return <Modal open onClose={onClose} dirty={dirty} onSave={busy ? undefined : () => void run(save)} title={`${draft.name} · ${draft.pluginId}`} size="xl" sidePanelInset={CHAT_DOCK_INSET}>
    <ModalBody spacing="sm">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      {changedElsewhere && dirty ? <p className="text-sm text-warning">{t({ ko: '다른 곳에서 초안을 변경했어. 미저장 내용을 보관한 뒤 최신 소스를 다시 열어줘.', en: 'The draft changed elsewhere. Keep your unsaved text, then reload the latest source.' })}</p> : null}
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="w-full shrink-0 space-y-2 md:w-56 md:border-r md:border-line md:pr-3">
          <div className="max-h-52 overflow-y-auto md:max-h-[48vh]">
            {draft.files.map(file => <ListRow key={file.name} asChild selected={selectedFile === file.name} size="sm"><button type="button" disabled={busy || dirty} onClick={() => void run(() => load(file.name))} title={`${file.name} (${file.size})`}><span className="truncate font-mono text-xs">{file.name}</span></button></ListRow>)}
          </div>
          <Input aria-label={t({ ko: '새 파일 이름', en: 'New file name' })} placeholder="src/helper.js" value={newTarget} onChange={event => setNewTarget(event.target.value)} />
          <div className="flex flex-wrap items-center gap-1">
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '파일 추가', en: 'Add file' })} disabled={busy || dirty || !newTarget} onClick={() => void run(addFile)}><FilePlus /></IconButton>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '파일 업로드', en: 'Upload asset' })} disabled={busy || dirty} onClick={() => uploadInput.current?.click()}><Upload /></IconButton>
            <Button size="sm" variant="ghost" disabled={busy || dirty || !newTarget || !selectedFile} onClick={() => void run(renameFile)}>{t({ ko: '선택 파일 이름 변경', en: 'Rename selected file' })}</Button>
          </div>
          <input ref={uploadInput} className="hidden" type="file" onChange={event => { const file = event.target.files?.[0]; if (file) void run(() => upload(file)); event.target.value = '' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{selectedFile || t({ ko: '파일을 선택해줘', en: 'Select a file' })}{dirty ? ' *' : ''}</span>
            <IconButton variant="ghost" size="icon-sm" disabled={busy || dirty} label={t({ ko: '최신 소스 읽기', en: 'Reload source' })} onClick={() => void run(() => load(document?.target ?? 'plugin.json'))}><RefreshCw /></IconButton>
            <Button variant="destructive-ghost" size="sm" disabled={busy || dirty || !selectedFile} onClick={() => void run(removeFile)}>{t({ ko: '파일 삭제', en: 'Delete file' })}</Button>
          </div>
          {document ? (
            <Suspense fallback={<LoadingState variant="inline" />}>
              <PlainTextEditorLazy value={document.text} onChange={changeText} fileName={document.target} heightClassName="h-[45dvh] min-h-40" />
            </Suspense>
          ) : null}
        </div>
      </div>
      {review ? <PluginPackageReviewSummary review={review} metadata={review.conflict === 'none' ? null : <p className="pb-2 text-sm text-warning">{review.conflict === 'removed'
        ? t({ ko: '이 초안이 기준으로 삼은 설치본이 제거됐어. 설치하면 새로 설치돼.', en: 'The installation this draft was based on was removed. Installing adds it again.' })
        : t({ ko: '이 초안을 만든 뒤 설치본이 바뀌었어. 위 변경은 지금 설치본과 비교한 거고, 설치하면 지금 설치본을 이 초안으로 덮어써.', en: 'The installed package changed after this draft was made. The changes above compare with it, and installing replaces it with this draft.' })}</p>} /> : null}
    </ModalBody>
    <EditorFooter onDelete={() => void run(removeDraft)} deleteLabel={t({ ko: '초안 삭제', en: 'Delete draft' })} deleteDisabled={busy} onSave={() => void run(save)} canSave={dirty && !busy} saving={busy}>
      <Button variant="ghost" disabled={busy || dirty} onClick={() => void run(download)}>{t({ ko: 'ZIP 내보내기', en: 'Export ZIP' })}</Button>
      <Button variant="secondary" disabled={busy || dirty} onClick={() => void run(prepare)}>{t({ ko: '검증 및 설치 검토', en: 'Validate and review' })}</Button>
      {review ? <Button variant="secondary" disabled={busy || dirty} onClick={() => void run(install)}>{review.conflict === 'changed' ? t({ ko: '덮어쓰기 설치', en: 'Install and replace' }) : t({ ko: '설치', en: 'Install' })}</Button> : null}
    </EditorFooter>
  </Modal>
}
