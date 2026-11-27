import { CHAT_PAGE_LIMITS, isPrivateChatPageKey, REFMOD_ENTRY_LIMITS, SNAPREF_SIMPLE_NODE_EDITOR, type ChatPageData, type ChatPageField, type MiniMaxH3RefModKind } from '@conai/shared'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageFreeText, pageNumber, pageObject, pageRecord, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { useChatPageMedia } from '@/features/codex-chat/use-chat-page-media'
import { applyMiniMaxDirectorChatMedia } from '@/features/image-generation/components/comfy-chat-director-media'
import { applyComfyChatNode, comfyNodeChatData, COMFY_NODE_PATCH_SCHEMA } from '@/features/image-generation/components/comfy-chat-node'
import { getMiniMaxH3DirectorAssetRefs, isMiniMaxH3DirectorInputLink, normalizeMiniMaxH3DirectorNodeValue } from '@/features/image-generation/components/minimax-h3-director-dasiwa-utils'
import type { WorkflowFieldDraftValue } from '@/features/image-generation/image-generation-shared'
import { useI18n } from '@/i18n'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { REFMOD_ENTRY_SORTS, type RefModEntrySort, type RefModEntrySummary } from '@/lib/api-refmod-entries'
import { REFMOD_CONCEPTS, REFMOD_SERVER_FILTERS, refModBuildBlockReason, type RefModServerFilter } from './refmod-shared'
import type { RefModLibrary } from './use-refmod-library'

/** Entries listed (and accepted as choices): the latest loaded ones, like the art styles page. */
const ENTRY_LIMIT = 200
const UNREGISTERED_LIMIT = 100
const DIRECTOR_EDITOR = 'minimax_h3_director_dasiwa'
const NODE_EDITORS = [DIRECTOR_EDITOR, 'power_lora_loader_rgthree', SNAPREF_SIMPLE_NODE_EDITOR]
const IN_PLACE = ['refmod.filter', 'refmod.load_more', 'refmod.server']
const protectedField = (field: WorkflowMarkedField) => isPrivateChatPageKey(`${field.id}.${field.label}.${field.jsonPath}`)
const counts = (kinds: readonly MiniMaxH3RefModKind[]) => kinds.reduce<Record<string, number>>((result, kind) => ({ ...result, [kind]: (result[kind] ?? 0) + 1 }), {})
const clip = (value: unknown) => pageFreeText(String(value ?? '').slice(0, 240))

/** Trimmed, each once (case-insensitive, first spelling kept), like the keyword chips. */
const terms = (value: ChatPageData | undefined) => {
  const list = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
  return list.filter((term, index) => list.findIndex((other) => other.toLowerCase() === term.toLowerCase()) === index)
}

/**
 * Connects the RefMod view (/characters?view=refmods) to a chat: the list's scope, the default server's status, the
 * loaded and unregistered rows, and the open entry. The entry's workflow form fills through the ComfyUI page's own
 * mechanics (page fields, comfy.node, media.attach / media.clear; the Director keeps the entry's own source files);
 * favorites and 등록 apply at once; create, save, delete and build are review cards. Everything goes through the same
 * library state and actions as the screen.
 */
export function useRefModChatPage(library: RefModLibrary) {
  const { t } = useI18n()
  const { editor, canEdit, canDelete, loadMore, presence } = library
  const { base, latest, draft, ready, activeForm } = editor
  const visible = library.visibleEntries
  const listed = visible?.slice(-ENTRY_LIMIT) ?? []
  const listedIds = listed.map((entry) => entry.id)
  const unregistered = library.allUnregisteredRows.slice(0, UNREGISTERED_LIMIT)
  // The open entry is built under its draft name, after its unsaved changes are saved (as the window's build key).
  const blockOf = (entry: RefModEntrySummary) => refModBuildBlockReason(t, {
    ...entry, pending: library.isPending(entry), ...(entry.id === base?.id ? { name: editor.nameValue.trim() || entry.name } : {}),
  }, presence.data, entry.id === base?.id && editor.dirty)

  // The open entry's form, as the ComfyUI page offers a workflow's: plain fields, node editors and media inputs.
  const editable = canEdit && ready && Boolean(activeForm)
  const safe = editable ? editor.fields.filter((field) => !protectedField(field)) : []
  const nodeFields = safe.filter((field) => field.type === 'node' && NODE_EDITORS.includes(field.node_editor ?? ''))
  // SnapRef pictures are attached on the generation page only; comfy.node still edits a SnapRef node here.
  const mediaFields = safe.filter((field) => field.type === 'image' || (field.node_editor === DIRECTOR_EDITOR && (field.node_visible_fields ?? ['timeline_data']).includes('timeline_data') && !isMiniMaxH3DirectorInputLink(normalizeMiniMaxH3DirectorNodeValue(draft.values[field.id]).timeline_data)))
  const media = useChatPageMedia(mediaFields.map((field) => field.id))
  const commit = useChatDraftTransaction(draft.values, (next) => {
    for (const [id, value] of Object.entries(next)) if (editor.draftRef.current.values[id] !== value) editor.setValue(id, value)
  })
  const fields: ChatPageField[] = safe.filter((field) => field.type !== 'image' && field.type !== 'node').slice(0, CHAT_PAGE_LIMITS.fields).flatMap((field) => {
    const value = draft.values[field.id] ?? ''
    if (typeof value !== 'string' && !(Array.isArray(value) && value.every((part) => typeof part === 'string'))) return []
    const select = field.type === 'select' && !!field.options?.length && field.options.length <= CHAT_PAGE_LIMITS.options
    return [{ id: field.id, label: field.label, type: field.type === 'number' ? 'number' as const : select ? 'select' as const : 'text' as const, value,
      ...(field.type === 'number' ? { min: field.min, max: field.max, integer: Number.isInteger(field.step) && (field.step ?? 0) >= 1, allowEmpty: !field.required } : {}), ...(select ? { options: field.options } : {}) }]
  })
  const chatNodes = nodeFields.map((field) => comfyNodeChatData(field, draft.values[field.id], { refModExportOnly: true }))
  const nameField = activeForm?.roles.name ?? null
  const inputSchema = Object.fromEntries(fields.map((field) => [field.id, field.type === 'number' ? pageNumber(field.min, field.max, field.integer)
    : field.type === 'select' && field.options?.length ? pageChoice(field.options) : Array.isArray(field.value) ? pageArray(pageText(CHAT_PAGE_LIMITS.text)) : pageText(CHAT_PAGE_LIMITS.text)]))
  /** Validate the whole patch before any input changes, as the ComfyUI page does. */
  const applyInputs = (patch: Record<string, unknown>) => {
    for (const [id, value] of Object.entries(patch)) {
      const field = safe.find((item) => item.id === id)
      if (!field || field.type === 'image' || field.type === 'audio' || field.type === 'video' || field.type === 'node' || (field.type === 'select' && !field.options?.includes(String(value)))) throw new Error(t({ ko: '현재 선택 목록에 없는 입력이야.', en: 'This input is not in the current choices.' }))
    }
    for (const [id, value] of Object.entries(patch)) editor.setValue(id, value as WorkflowFieldDraftValue)
  }
  const buildIds = [...new Set([...listedIds, ...(ready && base ? [base.id] : [])])]
  const unregisteredKeys = unregistered.map((row) => row.key)

  const presenceData: ChatPageData = presence.isPending ? { status: 'loading' }
    : presence.isError ? { status: 'error' }
      : presence.data?.status === 'ok' ? { status: 'ok', name: pageFreeText(presence.data.serverName), names: presence.data.entries.length }
        : presence.data ? { status: presence.data.status, message: clip(presence.data.message) } : null

  useChatPageRegistration({
    kind: 'page',
    title: editor.open
      ? (base ? t({ ko: 'RefMod · {name}', en: 'RefMod · {name}' }, { name: base.name }).slice(0, 160)
        : editor.isNew ? t({ ko: '새 RefMod', en: 'New RefMod' })
          : editor.recordPreview ? t({ ko: 'RefMod · {name}', en: 'RefMod · {name}' }, { name: editor.recordPreview.name }).slice(0, 160) : 'RefMod')
      : 'RefMod',
    resourceId: editor.open
      ? (editor.entryId !== null ? `refmod:${editor.entryId}` : editor.recordPreview ? `refmod:record:${editor.recordPreview.recordId}` : 'refmod:new')
      : 'refmods',
    priority: editor.open ? 10 : 0,
    dirty: editor.dirty,
    // A 'page' registration carries no page fields (the shared normaliser refuses them): the plain inputs fill through refmod.draft.
    fields: [],
    data: {
      query: library.query,
      server: library.serverFilter,
      concept: library.concept,
      sort: library.sort,
      defaultServer: presenceData,
      entries: visible ? {
        total: library.serverFilter === 'all' ? library.total ?? visible.length : visible.length,
        hasMore: Boolean(loadMore),
        offset: visible.length - listed.length,
        items: listed.map((entry) => ({
          id: entry.id, name: pageFreeText(entry.name), concept: entry.conceptType, description: clip(entry.description), members: counts(entry.members.map((member) => member.kind)),
          onServer: library.presenceOk ? library.isOnServer(entry.name) : null, pending: library.isPending(entry), buildBlock: blockOf(entry),
          issues: entry.issues.map((issue) => issue.code), lastBuiltAt: entry.lastBuiltAt, favorite: entry.favorite, revision: entry.revision,
        })),
      } : null,
      unregistered: {
        total: library.unregisteredCount,
        items: unregistered.map((row) => ({ key: row.key, kind: row.kind, name: pageFreeText(row.name), concept: row.conceptType, members: counts(row.kinds) })),
      },
      selected: !editor.open ? null
        : editor.recordPreview ? { ready: true, recordId: editor.recordPreview.recordId, registered: false, name: pageFreeText(editor.recordPreview.name), concept: editor.recordPreview.conceptType, description: clip(editor.recordPreview.description) }
          : !ready ? { ready: false, id: editor.entryId }
            : !base || !latest ? {
              ready: true,
              id: null,
              isNew: true,
              registered: false,
              dirty: editor.dirty,
              busy: editor.busy,
              name: pageFreeText(editor.nameValue),
              nameField,
              keywords: draft.keywords,
              workflow: activeForm ? { id: activeForm.workflow.id, name: pageFreeText(activeForm.workflow.name) } : null,
              roles: activeForm?.roles ?? null,
              draftError: editor.draftError,
              inputs: editable ? fields : [],
              images: mediaFields.map((field) => ({ fieldId: field.id, label: field.label })),
            } : {
              ready: true,
              id: base.id,
              registered: latest.registered,
              revision: base.revision,
              dirty: editor.dirty,
              busy: editor.busy,
              favorite: latest.favorite,
              name: pageFreeText(editor.nameValue),
              nameField,
              concept: latest.conceptType,
              description: clip(latest.description),
              keywords: draft.keywords,
              workflow: base.form ? { id: base.form.workflow.id, name: pageFreeText(base.form.workflow.name) } : null,
              roles: base.form?.roles ?? null,
              issues: latest.issues.map((issue) => ({ code: issue.code, severity: issue.severity, ...(issue.fields ? { fields: issue.fields.map((field) => ({ id: field.id, label: pageFreeText(field.label) })) } : {}) })),
              buildable: latest.buildable,
              pending: library.isPending(latest),
              buildBlock: blockOf(latest),
              draftError: editor.draftError,
              members: latest.members.map((member) => ({ kind: member.kind, description: clip(member.description) })),
              runs: latest.records.slice(0, 3).map((record) => ({ status: record.status, error: record.error ? clip(record.error) : null, createdAt: record.createdAt })),
              inputs: editable ? fields : editor.fields.filter((field) => field.type !== 'image' && field.type !== 'node' && !protectedField(field)).slice(0, 20).map((field) => ({ id: field.id, label: pageFreeText(field.label), value: clip(draft.values[field.id]) })),
              images: mediaFields.map((field) => ({ fieldId: field.id, label: field.label })),
            },
      nodes: chatNodes,
      media: media.candidates,
    } as Record<string, ChatPageData>,
    actions: [
      pageAction('refmod.filter', t({ ko: 'RefMod 목록 필터·정렬', en: 'Filter and sort RefMods' }), t({ ko: '검색어(낱말마다 이름·설명·검색어·멤버 설명 중 하나와 맞아야 해), 서버(all 전체 / on 서버에 있음 / off 없음 / unregistered 미등록만), 종류(빈 값은 전체), 정렬을 바꿔. 주어진 항목만 바뀌고 열린 RefMod는 그대로야.', en: 'Change the query (each word must match a name, description, keyword or member description), the server filter (all / on: on the default server / off: not there / unregistered only), the concept (empty: all) and the sort. Only given fields change; an open RefMod stays open.' }), pageObject({ query: pageText(200), server: pageChoice([...REFMOD_SERVER_FILTERS]), concept: pageChoice(['', ...REFMOD_CONCEPTS]), sort: pageChoice([...REFMOD_ENTRY_SORTS]) })),
      ...(loadMore ? [pageAction('refmod.load_more', t({ ko: 'RefMod 더 불러오기', en: 'Load more RefMods' }), t({ ko: '목록의 다음 묶음을 불러와. data.entries.items는 마지막으로 불러온 최대 {limit}개이고 offset은 그 첫 항목의 위치야.', en: 'Load the next batch; data.entries.items holds the latest {limit} loaded entries at most and offset is the first one’s position.' }, { limit: ENTRY_LIMIT }), pageObject({}))] : []),
      pageAction('refmod.server', t({ ko: '서버 상태 새로고침', en: 'Refresh server status' }), t({ ko: '대표 ComfyUI 서버의 RefMod 목록을 다시 읽어(있음·없음·미등록이 바뀌어).', en: 'Read the default ComfyUI server’s RefMod library again (updates on/off and unregistered).' }), pageObject({})),
      pageAction('refmod.open', t({ ko: 'RefMod 열기', en: 'Open RefMod' }), t({ ko: 'RefMod를 상세 창으로 열어. 초안은 data.selected, 워크플로 입력은 페이지 필드와 data.nodes야.', en: 'Open a RefMod in its window; its draft is data.selected, its workflow inputs the page fields and data.nodes.' }), pageObject({ entryId: pageNumber(1, undefined, true) }, ['entryId'])),
      ...(editor.open ? [pageAction('refmod.close', t({ ko: 'RefMod 닫기', en: 'Close RefMod' }), t({ ko: '열린 RefMod 창을 닫아.', en: 'Close the open RefMod window.' }), pageObject({}))] : []),
      ...(canEdit ? [
        pageAction('refmod.create', t({ ko: '새 RefMod 만들기', en: 'Create RefMod' }), t({ ko: '이 이름(파일 이름 하나, 경로 없이)으로 새 RefMod를 만들고 열어. 같은 이름은 거절돼.', en: 'Create a RefMod with this name (one plain file name, no path) and open it; a taken name is refused.' }), pageObject({ name: pageText(REFMOD_ENTRY_LIMITS.name) }, ['name']), 'save'),
        ...(listedIds.length ? [pageAction('refmod.favorite', t({ ko: '즐겨찾기 표시', en: 'Mark favorites' }), t({ ko: 'data.entries의 RefMod에 즐겨찾기를 켜거나 꺼. 바로 반영돼.', en: 'Turn the favorite mark of listed RefMods on or off; applies at once.' }), pageObject({ entryIds: pageArray(pageChoice(listedIds), listedIds.length, 1), favorite: { type: 'boolean' } }, ['entryIds', 'favorite']), 'save')] : []),
        ...(unregisteredKeys.length ? [pageAction('refmod.adopt', t({ ko: '미등록 RefMod 등록', en: 'Register unregistered RefMods' }), t({ ko: 'data.unregistered의 항목을 key로 등록해. 보관된 항목·실행은 소스를 유지·복사하고, 서버에만 있는 이름은 정보만 가져와. 바로 반영돼.', en: 'Register data.unregistered rows by key: kept entries and saved runs keep or copy sources, server-only names bring metadata only. Applies at once.' }), pageObject({ keys: pageArray(pageChoice(unregisteredKeys), unregisteredKeys.length, 1) }, ['keys']), 'save')] : []),
        ...(editor.open && ready && !editor.recordPreview ? [
          pageAction('refmod.draft', t({ ko: 'RefMod 초안 채우기', en: 'Fill RefMod draft' }), t({ ko: '열린 RefMod 초안의 주어진 항목만 바꿔. 검색어는 목록 전체를 바꿔. inputs는 selected.inputs에 나온 워크플로 입력을 id로 채우고, 노드 입력은 comfy.node로 채워. 저장하지 않아.', en: 'Change only the given fields of the open RefMod’s draft; keywords replace the whole list. inputs sets the workflow’s plain inputs listed in selected.inputs by id; node inputs fill through comfy.node. Nothing is saved.' }), pageObject({
            ...(nameField ? {} : { name: pageText(REFMOD_ENTRY_LIMITS.name) }),
            keywords: pageArray(pageText(REFMOD_ENTRY_LIMITS.keyword), REFMOD_ENTRY_LIMITS.keywords),
            ...(fields.length ? { inputs: pageObject(inputSchema) } : {}),
          })),
          ...(nodeFields.length ? [pageAction('comfy.node', t({ ko: 'H3·LoRA·SnapRef 노드 입력', en: 'Edit H3, LoRA or SnapRef inputs' }), t({ ko: 'nodes에 나온 노드별 schema에 맞춰 patch를 입력해. 타임라인은 기존 미디어 ID만 편집하고 새 소스는 media.attach로 넣어.', en: 'Match patch to the node-specific schema in nodes. Edit existing timeline media IDs; add new sources with media.attach.' }), pageObject({ fieldId: pageChoice(nodeFields.map((field) => field.id)), patch: COMFY_NODE_PATCH_SCHEMA }, ['fieldId', 'patch']))] : []),
          ...media.actions,
          pageAction('refmod.save', t({ ko: 'RefMod 저장', en: 'Save RefMod' }), t({ ko: '열린 RefMod의 지금 초안을 저장해. 소스는 RefMod 파일로 복사돼.', en: 'Save the open RefMod’s draft; sources are copied into the RefMod’s own files.' }), pageObject({}), 'save'),
          ...(base && canDelete ? [pageAction('refmod.delete', t({ ko: 'RefMod 삭제', en: 'Delete RefMod' }), t({ ko: '등록된 RefMod는 파일함을 유지한 채 미등록으로 옮기고, 미등록 항목은 원본 파일·실행 기록까지 영구 삭제해.', en: 'Moves a registered RefMod to Unregistered keeping its files, or permanently deletes an unregistered RefMod with its files and run records.' }), pageObject({}), 'save')] : []),
        ] : []),
      ] : []),
      ...(buildIds.length ? [pageAction('refmod.build', t({ ko: 'RefMod 만들기', en: 'Build RefMod' }), t({ ko: '대표 ComfyUI 서버에서 RefMod를 만들어. 열린 RefMod에 저장하지 않은 변경이 있으면 먼저 저장해. buildBlock이 있는 항목은 거절돼.', en: 'Build a RefMod on the default ComfyUI server; an open RefMod with unsaved changes is saved first. Entries with a buildBlock are refused.' }), pageObject({ entryId: pageChoice(buildIds) }, ['entryId']), 'save')] : []),
    ],
    apply: applyInputs,
    applyAction: async (id, args, assertCurrent): Promise<WorkflowUndo | void> => {
      assertCurrent()
      if (editor.isBusy() && !IN_PLACE.includes(id)) throw new Error(t({ ko: '저장이나 업로드가 끝난 뒤 다시 해줘.', en: 'Wait for the save or upload to finish.' }))
      if (id === 'refmod.filter') {
        if (args.query !== undefined) library.search(String(args.query))
        library.setListView({
          ...(args.sort !== undefined ? { sort: String(args.sort) as RefModEntrySort } : {}),
          ...(args.server !== undefined ? { server: String(args.server) as RefModServerFilter } : {}),
          ...(args.concept !== undefined ? { concept: String(args.concept) } : {}),
        })
        return
      }
      if (id === 'refmod.load_more') {
        if (!loadMore) throw new Error(t({ ko: '목록을 이미 다 불러왔어.', en: 'Everything is loaded already.' }))
        await loadMore()
        return
      }
      if (id === 'refmod.server') { await library.refreshPresence(); return }
      if (id === 'refmod.open') { library.openEntry(Number(args.entryId)); return }
      if (id === 'refmod.close') { library.closeEntry(); return }
      if (id === 'refmod.create') {
        if (!await library.create(String(args.name ?? ''))) {
          throw new Error(t({ ko: 'RefMod를 만들지 못했어. 이름을 확인해줘.', en: 'Could not create the RefMod. Check the name.' }))
        }
        return
      }
      if (id === 'refmod.favorite') {
        if (!await library.bulk({ action: 'favorite', ids: Array.isArray(args.entryIds) ? args.entryIds.map(Number) : [], favorite: args.favorite === true })) throw new Error(t({ ko: '즐겨찾기를 바꾸지 못했어.', en: 'Could not change the favorites.' }))
        return
      }
      if (id === 'refmod.adopt') {
        const keys = new Set(terms(args.keys))
        const rows = library.allUnregisteredRows.filter((row) => keys.has(row.key))
        if (!rows.length) throw new Error(t({ ko: '등록할 미등록 항목이 목록에 없어.', en: 'Those unregistered rows are no longer listed.' }))
        const result = await library.adopt(rows)
        if (!result || (!result.created && !result.linked)) throw new Error(t({ ko: '등록하지 못했어.', en: 'Could not register.' }))
        return
      }
      if (id === 'refmod.build') {
        const entryId = Number(args.entryId)
        const entry = latest?.id === entryId ? latest : listed.find((item) => item.id === entryId)
        if (!entry) throw new Error(t({ ko: '그 RefMod가 목록에 없어.', en: 'That RefMod is not listed.' }))
        if (!await library.build(entry)) throw new Error(t({ ko: '만들기를 시작하지 못했어.', en: 'Could not start the build.' }))
        return
      }
      if (!editor.open) throw new Error(t({ ko: 'RefMod를 먼저 열어줘 (refmod.open).', en: 'Open a RefMod first (refmod.open).' }))
      if (!ready) throw new Error(t({ ko: 'RefMod를 아직 불러오는 중이야. 잠시 뒤 다시 해줘.', en: 'The RefMod is still loading. Try again shortly.' }))
      if (id === 'refmod.save') { await editor.save(); return }
      if (id === 'refmod.delete') {
        if (!await editor.remove(false)) throw new Error(t({ ko: 'RefMod를 지우지 못했어.', en: 'Could not delete the RefMod.' }))
        return
      }
      if (id === 'refmod.draft') {
        const input = pageRecord(args)
        const before = { name: editor.draftRef.current.name, keywords: editor.draftRef.current.keywords }
        const name = input.name !== undefined && !nameField ? String(input.name) : undefined
        const keywords = input.keywords !== undefined ? terms(input.keywords) : undefined
        const inputs = input.inputs !== undefined && Object.keys(pageRecord(input.inputs)).length ? pageRecord(input.inputs) : undefined
        if (name === undefined && keywords === undefined && !inputs) throw new Error(t({ ko: '바꿀 항목이 없어.', en: 'Nothing to change.' }))
        const beforeInputs = Object.fromEntries(Object.keys(inputs ?? {}).map((key) => [key, editor.draftRef.current.values[key]]))
        if (inputs) applyInputs(inputs)
        if (name !== undefined) editor.setName(name)
        if (keywords !== undefined) editor.setKeywords(keywords)
        return {
          isCurrent: () => (name === undefined || editor.draftRef.current.name === name) && (keywords === undefined || JSON.stringify(editor.draftRef.current.keywords) === JSON.stringify(keywords))
            && Object.entries(inputs ?? {}).every(([key, value]) => JSON.stringify(editor.draftRef.current.values[key]) === JSON.stringify(value)),
          restore: () => {
            for (const [key, value] of Object.entries(beforeInputs)) editor.setValue(key, value as WorkflowFieldDraftValue)
            if (name !== undefined) editor.setName(before.name)
            if (keywords !== undefined) editor.setKeywords(before.keywords)
          },
        }
      }
      const field = safe.find((item) => item.id === args.fieldId)
      if (!field) throw new Error(t({ ko: '입력 필드가 바뀌었어.', en: 'The input fields changed.' }))
      const values = editor.draftRef.current.values
      if (id === 'comfy.node') {
        const value = applyComfyChatNode(field, values[field.id], args.patch)
        assertCurrent()
        return commit({ ...values, [field.id]: value })
      }
      if (field.type === 'image' && (id === 'media.attach' || id === 'media.clear')) {
        const value = id === 'media.clear' ? '' : await (await media.load(args)).toImage()
        assertCurrent()
        return commit({ ...editor.draftRef.current.values, [field.id]: value })
      }
      if (field.node_editor === DIRECTOR_EDITOR) {
        // The wide getter: an attach keeps the entry's own source files next to new uploads.
        return applyMiniMaxDirectorChatMedia({ id, value: values[field.id], args, load: media.load, assertCurrent, assets: getMiniMaxH3DirectorAssetRefs, commit: (value) => commit({ ...editor.draftRef.current.values, [field.id]: value }) })
      }
      throw new Error(t({ ko: 'RefMod에 없는 작업이야.', en: 'Not a RefMod operation.' }))
    },
  })
}
