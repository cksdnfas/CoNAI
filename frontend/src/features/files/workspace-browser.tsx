import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, FileText, ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import type { WorkspaceEntry, WorkspaceOperation, WorkspaceText, WorkspaceBatchResult } from '@conai/shared'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PageToolbar } from '@/components/common/page-toolbar'
import { SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { applyWorkspace, createWorkspace, getWorkspace, listWorkspaceEntries, listWorkspaces, readWorkspace, searchWorkspace, workspaceChanges } from '@/lib/api-workspaces'
import { getErrorMessage } from '@/lib/error-message'
const PlainTextEditor = lazy(() => import('@/components/common/plain-text-editor').then(module => ({ default: module.PlainTextEditor })))

export function WorkspaceBrowser({ projectId, onProject, onBack }: { projectId: string | null; onProject: (id: string | null) => void; onBack: () => void }) {
  const { t } = useI18n()
  const failureMessage = (failure: unknown) => getErrorMessage(failure, t({ ko: '작업을 완료하지 못했어.', en: 'Could not complete the operation.' }))
  const auth = useAuthStatusQuery()
  const canWrite = auth.data?.permissionKeys?.includes('files.edit') === true
  const account = auth.data?.accountId ?? 'bootstrap'
  const client = useQueryClient()
  const confirm = useConfirm()
  const [projectOffset, setProjectOffset] = useState(0)
  const [folder, setFolder] = useState('')
  const [offset, setOffset] = useState(0)
  const [name, setName] = useState('')
  const [guidelines, setGuidelines] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [destination, setDestination] = useState('')
  const [editor, setEditor] = useState<WorkspaceText | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const projects = useQuery({ queryKey: ['workspaces', 'list', account, projectOffset], queryFn: () => listWorkspaces(projectOffset) })
  const project = useQuery({ queryKey: ['workspaces', projectId, account, 'info'], queryFn: () => getWorkspace(projectId!), enabled: !!projectId })
  const entries = useQuery({ queryKey: ['workspaces', projectId, account, 'entries', folder, offset], queryFn: () => listWorkspaceEntries(projectId!, folder, offset), enabled: !!projectId && !query })
  const results = useQuery({ queryKey: ['workspaces', projectId, account, 'search', query, offset], queryFn: () => searchWorkspace(projectId!, query, offset), enabled: !!projectId && !!query })
  const changes = useQuery({ queryKey: ['workspaces', projectId, account, 'changes'], queryFn: () => workspaceChanges(projectId!), enabled: !!projectId })
  const shown = query ? results.data?.hits ?? [] : entries.data?.entries ?? []
  const next = query ? results.data?.nextOffset : entries.data?.nextOffset
  const dirty = !!editor && draft !== editor.text
  const refresh = () => client.invalidateQueries({ queryKey: ['workspaces', projectId] })
  const mutation = useMutation({ mutationFn: async (operations: WorkspaceOperation[]) => {
    const result = await applyWorkspace(projectId!, operations)
    await refresh()
    if (result.status !== 'completed') throw new Error(`${result.error ?? result.status} (${result.results.length}/${operations.length})`)
    return result
  }, onError: failure => setError(failureMessage(failure)) })
  const creation = useMutation({ mutationFn: () => createWorkspace(name, guidelines), onSuccess: async value => {
    await client.invalidateQueries({ queryKey: ['workspaces', 'list'] })
    onProject(value.id)
  }, onError: failure => setError(failureMessage(failure)) })
  const discard = async () => !dirty || await confirm({ title: t({ ko: '저장하지 않은 변경을 버릴까?', en: 'Discard unsaved changes?' }) })
  const open = async (entry: WorkspaceEntry) => {
    if (!await discard()) return
    setError(null)
    try {
      if (entry.kind === 'folder') { setFolder(entry.target); setOffset(0); setQuery(''); setSelected([]); setEditor(null); return }
      const result = await readWorkspace(projectId!, [{ target: entry.target, limit: 1048576 }])
      setEditor(result.files[0]); setDraft(result.files[0].text)
    } catch (failure) { setError(failureMessage(failure)) }
  }
  const newDocument = () => { setEditor({ target: folder ? `${folder}/${name}` : name, text: '', revision: '', size: 0, offset: 0, nextOffset: null }); setDraft('') }
  const save = async () => {
    if (!editor || editor.nextOffset !== null || editor.offset !== 0) throw new Error(t({ ko: '전체를 연 문서만 저장할 수 있어. 긴 문서는 채팅의 부분 편집을 사용해줘.', en: 'Only a complete document can be saved. Use chat partial edits for large files.' }))
    const result = await mutation.mutateAsync([{ kind: 'write', target: editor.target, text: draft, expectedRevision: editor.revision || null }])
    setEditor({ ...editor, text: draft, revision: result.results[0].revision!, size: new TextEncoder().encode(draft).length })
  }
  const move = async () => {
    const targets = shown.filter(entry => selected.includes(entry.target) && entry.kind === 'file')
    const read = await readWorkspace(projectId!, targets.map(entry => ({ target: entry.target, limit: 4 })))
    await mutation.mutateAsync(read.files.map(file => ({ kind: 'move', target: file.target, destination: [destination, file.target.split('/').at(-1)].filter(Boolean).join('/'), expectedRevision: file.revision })))
    setSelected([])
  }
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn() } catch (failure) { setError(failureMessage(failure)) } }
  useChatPageRegistration({ kind: 'files', title: project.data?.name ?? t({ ko: '작업 공간', en: 'Workspaces' }), resourceId: projectId ? `workspace:${projectId}` : 'workspaces', localRevision: JSON.stringify([folder, offset, selected, editor?.target, editor?.revision, draft, name, guidelines, query]), dirty,
    fields: [{ id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: name }, { id: 'search', label: t({ ko: '검색어', en: 'Search' }), type: 'text', value: search }, ...(!projectId && guidelines.length <= 2000 ? [{ id: 'guidelines', label: t({ ko: '프로젝트 지침', en: 'Guidelines' }), type: 'text' as const, value: guidelines }] : []), ...(editor && draft.length <= 2000 ? [{ id: 'draft', label: t({ ko: '문서 내용', en: 'Document text' }), type: 'text' as const, value: draft }] : [])],
    data: { projects: (projects.data ?? []).slice(0, 50).map(item => ({ id: item.id, name: item.name })), entries: shown.map(entry => ({ id: entry.id, target: entry.target, kind: entry.kind })), folder, offset, ...(editor ? { editor: { target: editor.target, characters: draft.length, complete: editor.offset === 0 && editor.nextOffset === null } } : {}) },
    actions: [pageAction('workspace.open', t({ ko: '항목 열기', en: 'Open item' }), '', pageObject({ target: pageText(1000) }, ['target'])), ...(projectId ? [pageAction('workspace.search', t({ ko: '검색', en: 'Search' }), '')] : []), ...(canWrite ? [...(projectId ? [pageAction('workspace.new', t({ ko: '새 문서 편집', en: 'New document' }), ''), pageAction('workspace.mkdir', t({ ko: '폴더 만들기', en: 'Create folder' }), '', undefined, 'save')] : [pageAction('workspace.create', t({ ko: '프로젝트 만들기', en: 'Create project' }), '', undefined, 'save')]), ...(editor && editor.offset === 0 && editor.nextOffset === null ? [pageAction('workspace.save', t({ ko: '문서 저장', en: 'Save document' }), '', undefined, 'save')] : [])] : [])],
    apply: patch => { if (patch.name !== undefined) setName(String(patch.name)); if (patch.search !== undefined) setSearch(String(patch.search)); if (patch.draft !== undefined) setDraft(String(patch.draft)); if (patch.guidelines !== undefined) setGuidelines(String(patch.guidelines)) },
    applyAction: async (action, args, assertCurrent) => {
      assertCurrent()
      if (action === 'workspace.search') { setQuery(search); setOffset(0); return }
      if (action === 'workspace.create') { await creation.mutateAsync(); return }
      if (action === 'workspace.new' && projectId && name.trim()) { newDocument(); return }
      if (action === 'workspace.mkdir' && projectId) { await mutation.mutateAsync([{ kind: 'mkdir', target: [folder, name].filter(Boolean).join('/') }]); return }
      if (action === 'workspace.save') { await save(); return }
      if (action === 'workspace.open') {
        const item = shown.find(entry => entry.target === args.target)
        if (item) { await open(item); return }
        const found = projects.data?.find(item => item.id === args.target)
        if (found && !dirty) { onProject(found.id); return }
      }
      throw new Error('현재 화면에서 사용할 수 없는 작업이야.')
    },
  })
  return <PageWithSidebar storageKey="workspaces" sidebarLabel={t({ ko: '작업 공간', en: 'Workspaces' })} sidebar={<SidebarNav>
    <SidebarItem icon={ArrowLeft} label={t({ ko: '공용 파일', en: 'Shared files' })} onClick={() => void act(async () => { if (await discard()) onBack() })} />
    <SidebarItem icon={Plus} label={t({ ko: '새 프로젝트', en: 'New project' })} active={!projectId} onClick={() => void act(async () => { if (await discard()) onProject(null) })} />
    {projects.data?.slice(0, 50).map(item => <SidebarItem key={item.id} icon={Folder} label={item.name} active={projectId === item.id} onClick={() => void act(async () => { if (await discard()) onProject(item.id) })} />)}
    <div className="flex gap-2 p-2"><Button size="sm" variant="ghost" disabled={!projectOffset} onClick={() => setProjectOffset(Math.max(0, projectOffset - 50))}>{t({ ko: '이전', en: 'Previous' })}</Button><Button size="sm" variant="ghost" disabled={(projects.data?.length ?? 0) <= 50} onClick={() => setProjectOffset(projectOffset + 50)}>{t({ ko: '다음', en: 'Next' })}</Button></div>
  </SidebarNav>} toolbar={<PageToolbar><span className="text-sm font-medium">{project.data?.name ?? t({ ko: '작업 공간', en: 'Workspaces' })}</span><Button variant="ghost" size="sm" onClick={() => void refresh()}><RefreshCw />{t({ ko: '새로고침', en: 'Refresh' })}</Button></PageToolbar>}>
    <div className="flex flex-col gap-4 p-4">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {projects.isError || project.isError ? <ErrorState title={t({ ko: '프로젝트를 열지 못했어.', en: 'Could not open project.' })} error={projects.error ?? project.error} /> : null}
      {!projectId ? <div className="flex max-w-2xl flex-col gap-4">
        <Field label={t({ ko: '프로젝트 이름', en: 'Project name' })}><Input value={name} onChange={event => setName(event.target.value)} maxLength={100} /></Field>
        <Field label={t({ ko: '프로젝트 가이드라인', en: 'Project guidelines' })}><Textarea rows={12} value={guidelines} onChange={event => setGuidelines(event.target.value)} /></Field>
        <Button disabled={!canWrite || !name.trim() || creation.isPending} onClick={() => creation.mutate()}>{t({ ko: '프로젝트 만들기', en: 'Create project' })}</Button>
        <p className="text-sm text-muted-foreground">{t({ ko: '채팅의 컨텍스트에서 이 프로젝트를 연결하면 가이드라인과 파일을 함께 사용할 수 있어.', en: 'Connect this project in chat context to use its guidelines and files.' })}</p>
      </div> : <>
        <div className="flex flex-wrap items-end gap-2"><Button variant="ghost" onClick={() => void act(async () => { if (await discard()) { setFolder(folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''); setOffset(0); setEditor(null); setQuery('') } })}><ArrowLeft />{folder || '/'}</Button><Input aria-label={t({ ko: '파일 검색', en: 'Search files' })} value={search} onChange={event => setSearch(event.target.value)} className="max-w-xs" /><Button variant="secondary" onClick={() => { setQuery(search); setOffset(0) }}>{t({ ko: '검색', en: 'Search' })}</Button></div>
        {query ? <p className="text-xs text-muted-foreground">{t({ ko: '페이지별로 100개 파일의 앞 128KB를 검색해. 다음 페이지도 확인해줘.', en: 'Search checks 100 entries per page and the first 128KB of each file. Continue to the next page for more.' })}</p> : null}
        {(query ? results.isPending : entries.isPending) ? <LoadingState /> : null}
        {entries.error || results.error ? <ErrorState title={t({ ko: '파일을 불러오지 못했어.', en: 'Could not load files.' })} error={entries.error ?? results.error} /> : null}
        <div className="divide-y divide-line">{shown.map(entry => <div key={entry.id} className="flex items-center gap-2 py-1">
          {entry.kind === 'file' ? <Checkbox aria-label={entry.target} checked={selected.includes(entry.target)} onCheckedChange={checked => setSelected(current => checked ? [...current, entry.target].slice(0, 32) : current.filter(target => target !== entry.target))} /> : <Folder className="size-4" />}
          <Button variant="ghost" className="min-w-0 flex-1 justify-start" onClick={() => void open(entry)}>{entry.kind === 'file' ? <FileText /> : null}<span className="truncate">{entry.target}</span></Button><span className="text-xs text-muted-foreground">{entry.size.toLocaleString()} B</span>
        </div>)}</div>
        <div className="flex gap-2"><Button variant="ghost" disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - 100)); setSelected([]) }}>{t({ ko: '이전', en: 'Previous' })}</Button><Button variant="ghost" disabled={next == null} onClick={() => { setOffset(next!); setSelected([]) }}>{t({ ko: '다음', en: 'Next' })}</Button></div>
        {canWrite ? <div className="flex flex-wrap gap-2"><Input aria-label={t({ ko: '새 파일 또는 폴더 이름', en: 'New file or folder name' })} value={name} onChange={event => setName(event.target.value)} className="max-w-xs" /><Button variant="secondary" disabled={!name.trim() || mutation.isPending} onClick={() => void act(async () => { await mutation.mutateAsync([{ kind: 'mkdir', target: [folder, name].filter(Boolean).join('/') }]) })}>{t({ ko: '폴더 만들기', en: 'Create folder' })}</Button><Button variant="secondary" disabled={!name.trim()} onClick={() => void act(async () => { if (await discard()) newDocument() })}>{t({ ko: '새 문서', en: 'New document' })}</Button><Input type="file" aria-label={t({ ko: '텍스트 문서 가져오기', en: 'Import text documents' })} multiple className="max-w-xs" onChange={event => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void act(async () => {
            if (files.length > 100 || files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) throw new Error('한 번에 100개, 8MB까지 가져올 수 있어.')
            const operations = await Promise.all(files.map(async file => ({ kind: 'write' as const, target: [folder, file.name].filter(Boolean).join('/'), text: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()), expectedRevision: null })))
            await mutation.mutateAsync(operations)
          })
        }} /></div> : null}
        {selected.length && canWrite ? <div className="flex gap-2"><Input aria-label={t({ ko: '이동 대상 폴더', en: 'Destination folder' })} value={destination} onChange={event => setDestination(event.target.value)} placeholder={t({ ko: '대상 폴더 · 빈 값은 최상위', en: 'Destination · empty means root' })} /><Button disabled={mutation.isPending} onClick={() => void act(move)}>{t({ ko: '선택 파일 이동', en: 'Move selected files' })} ({selected.length})</Button></div> : null}
        {editor ? <section className="flex flex-col gap-2 border-t border-line pt-4"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{editor.target}</span><Button disabled={!canWrite || mutation.isPending || editor.offset !== 0 || editor.nextOffset !== null} onClick={() => void act(save)}>{t({ ko: '저장', en: 'Save' })}</Button></div>
          {canWrite ? <Suspense fallback={<LoadingState />}><PlainTextEditor value={draft} onChange={setDraft} fileName={editor.target} /></Suspense> : <Textarea readOnly rows={16} value={draft} aria-label={editor.target} />}
          {editor.nextOffset !== null ? <Button variant="secondary" onClick={() => void act(async () => { if (!await discard()) return; const value = await readWorkspace(projectId, [{ target: editor.target, offset: editor.nextOffset!, revision: editor.revision, limit: 1048576 }]); setEditor(value.files[0]); setDraft(value.files[0].text) })}>{t({ ko: '다음 부분 읽기', en: 'Read next part' })}</Button> : null}
        </section> : null}
        <details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm">{t({ ko: '최근 변경 내역', en: 'Recent changes' })}</summary>{changes.data?.map(change => {
          const result = JSON.parse(change.result) as WorkspaceBatchResult
          const status = change.status === 'completed' ? t({ ko: '완료', en: 'Completed' }) : change.status === 'running' ? t({ ko: '진행 중', en: 'Running' }) : t({ ko: '중단 또는 실패', en: 'Interrupted or failed' })
          return <div key={change.requestId} className="border-b border-line py-2 text-xs"><span>{change.createdAt} · {status} · {change.completed}{t({ ko: '개 반영', en: ' changes' })}</span><p className="break-all text-muted-foreground">{result.results.map(item => item.target).join(', ')}{change.completed > 10 ? ' …' : ''}</p>{result.error ? <p className="text-destructive">{result.error}</p> : null}</div>
        })}</details>
      </>}
    </div>
  </PageWithSidebar>
}
