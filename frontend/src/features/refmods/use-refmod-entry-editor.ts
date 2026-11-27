import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { REFMOD_ENTRY_LIMITS, type MiniMaxH3RefModKind } from '@conai/shared'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import {
  buildMiniMaxH3DirectorNodeValue,
  getMiniMaxH3DirectorAssetRefs,
  getMiniMaxH3DirectorAssets,
  isMiniMaxH3DirectorInputLink,
  normalizeMiniMaxH3DirectorNodeValue,
  parseMiniMaxH3DirectorTimeline,
  resolveMiniMaxH3DirectorCanvas,
  syncMiniMaxH3DirectorPromptBlocks,
  type MiniMaxH3DirectorTimelineItem,
} from '@/features/image-generation/components/minimax-h3-director-dasiwa-utils'
import { buildComfyDraftFromHistoryPayload } from '@/features/image-generation/history-settings-mapping'
import { buildWorkflowPromptData, joinWorkflowPromptSegments } from '@/features/image-generation/image-generation-drafts'
import { getImageDraftRevision, type WorkflowFieldDraftValue } from '@/features/image-generation/image-generation-shared'
import { resolveVisibleWorkflowFields } from '@/features/image-generation/workflow-field-choices'
import { useI18n } from '@/i18n'
import type { CustomDropdownList, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { getGenerationCustomDropdownLists } from '@/lib/api-image-generation-workflows'
import {
  createRefModEntry,
  deleteRefModEntry,
  getRefModDraftTemplate,
  getRefModEntry,
  invalidateRefModEntries,
  isRefModNameConflict,
  isRefModRevisionConflict,
  patchRefModEntry,
  refModEntryQueryKey,
  refModTemplateQueryKey,
  type RefModDraftTemplate,
  type RefModEntryDetail,
  type RefModEntryForm,
  type RefModEntryPatch,
} from '@/lib/api-refmod-entries'
import { deleteWorkflowInputAsset } from '@/lib/api-workflow-input-assets'
import { getErrorMessage } from '@/lib/error-message'
import type { RefModRowThumb } from './refmod-shared'

export type RefModServerSeed = {
  name: string
  conceptType: string
  description: string
  members: Array<{ kind: MiniMaxH3RefModKind; label: string }>
}

export type RefModRecordPreview = {
  recordId: number
  name: string
  conceptType: string
  description: string
  thumbs: RefModRowThumb[]
  kinds: MiniMaxH3RefModKind[]
  createdAt: string
}

/** What the RefMod dialog opens: an existing entry (registered or unregistered), a new/server draft, or a legacy record. */
export type RefModEditorTarget =
  | { kind: 'entry'; entryId: number }
  | { kind: 'new'; seed?: RefModServerSeed }
  | { kind: 'record'; record: RefModRecordPreview }
  | null

/** What a save sends: the entry name (only when the workflow has no name field), its search keywords and the form. */
export type RefModEntryDraft = {
  name: string
  keywords: string[]
  /** The linked workflow's form, keyed by field id, in the ComfyUI tab's draft shape. */
  values: Record<string, WorkflowFieldDraftValue>
}

const EMPTY_DRAFT: RefModEntryDraft = { name: '', keywords: [], values: {} }
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isImageDraft = (value: unknown) => isRecord(value) && typeof value.dataUrl === 'string' && typeof value.fileName === 'string'

/** The form's fields as the ComfyUI tab shows them (a field naming a dropdown list becomes its select). */
export function refModFormFields(form: RefModEntryForm | null | undefined, dropdownLists: readonly CustomDropdownList[] | undefined): WorkflowMarkedField[] {
  if (!form) return []
  const byName = new Map((dropdownLists ?? []).map((list) => [list.name, list]))
  return resolveVisibleWorkflowFields(form.fields as unknown as WorkflowMarkedField[], byName)
}

function draftValuesOfForm(form: RefModEntryForm | null | undefined, fields: WorkflowMarkedField[], seed?: RefModServerSeed): Record<string, WorkflowFieldDraftValue> {
  if (!form) return {}
  const stored: Record<string, unknown> = { ...form.values }
  if (seed) {
    if (form.roles.name) stored[form.roles.name] = seed.name
    if (form.roles.concept && seed.conceptType) stored[form.roles.concept] = seed.conceptType
    if (form.roles.description && seed.description) stored[form.roles.description] = seed.description
  }
  const images = Object.fromEntries(fields.flatMap((field) => (field.type === 'image' ? isImageDraft(stored[field.id]) : (field.type === 'audio' || field.type === 'video') && isRecord(stored[field.id])) ? [[field.id, stored[field.id] as WorkflowFieldDraftValue]] : []))
  return buildComfyDraftFromHistoryPayload({ prompt_data: stored }, fields, images)?.draft ?? {}
}

/** The stored entry as a draft: its composed values turned back into the tab's draft (image fields keep their value). */
export function refModDraftOf(entry: RefModEntryDetail, fields: WorkflowMarkedField[]): RefModEntryDraft {
  return { name: entry.name, keywords: entry.keywords, values: draftValuesOfForm(entry.form, fields) }
}

function templateDraftOf(template: RefModDraftTemplate, fields: WorkflowMarkedField[], seed?: RefModServerSeed): RefModEntryDraft {
  return { name: seed?.name ?? '', keywords: [], values: draftValuesOfForm(template.form, fields, seed) }
}

/**
 * The whole form as a save sends it. An emptied text field is sent empty (the stored value would otherwise stay); any
 * other emptied field goes back to the workflow's default, as an empty field does on the generation page.
 */
export function refModFormValues(fields: WorkflowMarkedField[], values: Record<string, WorkflowFieldDraftValue>) {
  const payload = buildWorkflowPromptData(fields, values)
  for (const field of fields) {
    if (field.id in payload) continue
    payload[field.id] = field.type === 'text' || field.type === 'textarea' || field.type === 'image' || field.type === 'audio' || field.type === 'video' ? '' : field.default_value ?? ''
  }
  return payload
}

/** Measured by the Director itself when a source's media loads (never typed by hand). */
const MEASURED_SOURCE_KEYS = new Set(['source_width', 'source_height', 'source_duration'])
const parseJson = (value: unknown) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return value }
}
/** JSON with object keys sorted, so two equal values compare equal whatever order their keys were written in. */
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => (
  isRecord(entry) ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry
))

function comparableDirectorValue(value: unknown, stored: unknown) {
  const source = parseJson(value)
  if (!isRecord(source)) return stableJson(source ?? null)
  try {
    const node = normalizeMiniMaxH3DirectorNodeValue(source)
    if (isMiniMaxH3DirectorInputLink(node.timeline_data)) return stableJson(node)
    const { timeline } = parseMiniMaxH3DirectorTimeline(node.timeline_data)
    const [canvasWidth, canvasHeight] = resolveMiniMaxH3DirectorCanvas(timeline)
    const items = timeline.items.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !MEASURED_SOURCE_KEYS.has(key))) as MiniMaxH3DirectorTimelineItem)
    const rebuilt = buildMiniMaxH3DirectorNodeValue({ ...node, timeline_data: JSON.stringify(syncMiniMaxH3DirectorPromptBlocks({ ...timeline, items })) }, {}, undefined, getMiniMaxH3DirectorAssetRefs(node))
    const storedNode = parseJson(stored)
    const followsCanvas = node.width === canvasWidth && node.height === canvasHeight && isRecord(storedNode)
    return stableJson({
      ...rebuilt,
      ...(followsCanvas ? { width: storedNode.width, height: storedNode.height } : {}),
      timeline_data: parseJson(rebuilt.timeline_data),
      builder_state: parseJson(rebuilt.builder_state),
    })
  } catch {
    return stableJson(source)
  }
}

/** The form values as the dirty check compares them (Director fields through comparableDirectorValue). */
function comparableFormValues(fields: WorkflowMarkedField[], values: Record<string, unknown> | null, stored: Record<string, unknown>) {
  if (!values) return values
  const comparable: Record<string, unknown> = { ...values }
  for (const field of fields) {
    if (field.type === 'node' && field.node_editor === 'minimax_h3_director_dasiwa' && field.id in comparable) comparable[field.id] = comparableDirectorValue(comparable[field.id], stored[field.id])
  }
  return comparable
}

const textOf = (value: WorkflowFieldDraftValue | undefined) => typeof value === 'string' ? value : Array.isArray(value) ? joinWorkflowPromptSegments(value) : ''

/** Workflow input uploads in the draft's Director values that the stored entry does not hold (new attachments). */
function newInputAssetIds(values: Record<string, WorkflowFieldDraftValue>, stored: Record<string, WorkflowFieldDraftValue>) {
  const ids = (source: Record<string, WorkflowFieldDraftValue>) => new Set(Object.values(source).flatMap((value) => Object.values(getMiniMaxH3DirectorAssets(value)).map((asset) => asset.id)))
  const kept = ids(stored)
  return [...ids(values)].filter((id) => !kept.has(id))
}

function targetKeyOf(target: RefModEditorTarget): string {
  if (!target) return ''
  if (target.kind === 'entry') return `entry:${target.entryId}`
  if (target.kind === 'record') return `record:${target.record.recordId}`
  return target.seed ? `server:${target.seed.name}` : 'new'
}

export function useRefModEntryEditor({ target, onCreated, onClose }: {
  target: RefModEditorTarget
  onCreated: (entry: RefModEntryDetail) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const entryId = target?.kind === 'entry' ? target.entryId : null
  const isNew = target?.kind === 'new'
  const serverSeed = target?.kind === 'new' ? target.seed : undefined
  const recordPreview = target?.kind === 'record' ? target.record : null
  const targetKey = targetKeyOf(target)

  const [pendingRefetch, setPendingRefetch] = useState(false)
  const [newWorkflowId, setNewWorkflowId] = useState<number | null | undefined>(undefined)

  const query = useQuery({
    queryKey: refModEntryQueryKey(entryId ?? 0),
    queryFn: ({ signal }) => getRefModEntry(entryId!, signal),
    enabled: entryId !== null,
    refetchInterval: pendingRefetch ? 15_000 : false,
  })
  const templateQuery = useQuery({
    queryKey: refModTemplateQueryKey(newWorkflowId),
    queryFn: ({ signal }) => getRefModDraftTemplate(newWorkflowId, signal),
    enabled: isNew,
    staleTime: 60_000,
  })
  const dropdownLists = useQuery({
    queryKey: ['image-generation-custom-dropdown-lists'],
    queryFn: () => getGenerationCustomDropdownLists(),
    enabled: (entryId !== null || isNew) && permissions.canRead,
    staleTime: 60_000,
  })

  const [base, setBase] = useState<RefModEntryDetail | null>(null)
  const [templateBase, setTemplateBase] = useState<RefModDraftTemplate | null>(null)
  const [draft, setDraft] = useState<RefModEntryDraft>(EMPTY_DRAFT)
  const [conflict, setConflict] = useState<RefModEntryDetail | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const activeForm = base ? base.form : templateBase?.form ?? null
  const fields = refModFormFields(activeForm, dropdownLists.data)
  const baseRef = useRef(base)
  baseRef.current = base
  const templateBaseRef = useRef(templateBase)
  templateBaseRef.current = templateBase
  const draftRef = useRef(draft)
  draftRef.current = draft
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields
  const deletedRef = useRef(false)
  const entryIdRef = useRef(entryId)
  entryIdRef.current = entryId

  const sessionRef = useRef(0)
  const operationsRef = useRef({ session: 0, count: 0 })
  const [operations, setOperations] = useState(operationsRef.current)
  const [loadedKey, setLoadedKey] = useState('')
  if (loadedKey !== targetKey) {
    setLoadedKey(targetKey)
    deletedRef.current = false
    const promotedFromNew = (loadedKey === 'new' || loadedKey.startsWith('server:')) && entryId !== null && base?.id === entryId
    if (!promotedFromNew) {
      sessionRef.current += 1
      setBase(null)
      setTemplateBase(null)
      setNewWorkflowId(undefined)
      setDraft(EMPTY_DRAFT)
      setConflict(null)
      setNameError(null)
    }
  }

  /** Comparable form of a draft (images by identity, not their base64), and why it cannot be sent. */
  const serialize = (value: RefModEntryDraft, form: RefModEntryForm | null | undefined, entryFields: WorkflowMarkedField[]) => {
    const namedByField = Boolean(form?.roles.name)
    try {
      const values = form ? refModFormValues(entryFields, value.values) : null
      return { key: getImageDraftRevision({ values: comparableFormValues(entryFields, values, form?.values ?? {}), name: namedByField ? null : value.name.trim(), keywords: value.keywords }), values, error: null as string | null }
    } catch (error) {
      return { key: `invalid:${Math.random()}`, values: null, error: getErrorMessage(error, t({ ko: '숫자 입력을 확인해줘.', en: 'Check the number inputs.' })) }
    }
  }

  const data = query.data
  if (data && data.id === entryId && loadedKey === targetKey) {
    if (base?.id !== data.id) {
      setBase(data)
      setDraft(refModDraftOf(data, refModFormFields(data.form, dropdownLists.data)))
    } else if (data.revision > base.revision && !conflict) {
      const baseDraft = refModDraftOf(base, fields)
      if (serialize(draft, base.form, fields).key === serialize(baseDraft, base.form, fields).key) {
        setBase(data)
        setDraft(refModDraftOf(data, refModFormFields(data.form, dropdownLists.data)))
      }
    }
  }

  const templateData = templateQuery.data
  if (isNew && templateData && loadedKey === targetKey && (!templateBase || templateBase.workflowId !== templateData.workflowId)) {
    const nextFields = refModFormFields(templateData.form, dropdownLists.data)
    const nextDraft = templateDraftOf(templateData, nextFields, serverSeed)
    if (templateBase) {
      // Switching workflow on a new draft: carry over typed name and keywords.
      const prevNameId = templateBase.form?.roles.name
      const typedName = prevNameId ? textOf(draft.values[prevNameId]) : draft.name
      const nextNameId = templateData.form?.roles.name
      if (typedName) {
        if (nextNameId) {
          const nextNameField = nextFields.find((field) => field.id === nextNameId)
          nextDraft.values[nextNameId] = nextNameField?.type === 'textarea' ? [typedName] : typedName
        } else {
          nextDraft.name = typedName
        }
      }
      nextDraft.keywords = draft.keywords
    }
    setTemplateBase(templateData)
    setDraft(nextDraft)
  }

  const ready = target !== null && (
    target.kind === 'record'
    || (target.kind === 'entry' && base?.id === entryId)
    || (target.kind === 'new' && templateBase !== null)
  )
  const latest = target?.kind === 'entry' && ready && data?.id === entryId && base && data.revision >= base.revision ? data : base
  const current = serialize(draft, activeForm, fields)
  const baselineDraft = base
    ? refModDraftOf(base, fields)
    : templateBase
      ? templateDraftOf(templateBase, fields, serverSeed)
      : EMPTY_DRAFT
  const dirty = ready && target?.kind !== 'record' && current.key !== serialize(baselineDraft, activeForm, fields).key
  const nameFieldId = activeForm?.roles.name ?? null
  const nameValue = nameFieldId ? textOf(draft.values[nameFieldId]) : draft.name
  if (pendingRefetch !== Boolean(latest?.pending)) setPendingRefetch(Boolean(latest?.pending))

  const session = sessionRef.current
  const isCurrent = () => sessionRef.current === session
  const onBusyChange = (busy: boolean) => {
    if (!isCurrent()) return
    const count = operationsRef.current.session === session ? operationsRef.current.count : 0
    operationsRef.current = { session, count: Math.max(0, count + (busy ? 1 : -1)) }
    setOperations(operationsRef.current)
  }
  const runBusy = async <T,>(task: () => Promise<T>) => {
    if (!isCurrent()) throw new Error(t({ ko: '열린 RefMod가 바뀌었어.', en: 'The open RefMod changed.' }))
    onBusyChange(true)
    try { return await task() } finally { onBusyChange(false) }
  }

  const discardUploads = (values: Record<string, WorkflowFieldDraftValue>, stored: RefModEntryDetail | null) => {
    const ids = newInputAssetIds(values, stored ? refModDraftOf(stored, fieldsRef.current).values : {})
    if (ids.length) void Promise.allSettled(ids.map((id) => deleteWorkflowInputAsset(id)))
  }
  const discardUploadsOnLeave = useRef(discardUploads)
  discardUploadsOnLeave.current = discardUploads
  const committed = useRef({ values: draft.values, base })
  useEffect(() => { committed.current = { values: draft.values, base } })
  useEffect(() => () => discardUploadsOnLeave.current(committed.current.values, committed.current.base), [targetKey])

  const adopt = (entry: RefModEntryDetail) => {
    const entryFields = refModFormFields(entry.form, dropdownLists.data)
    const next = refModDraftOf(entry, entryFields)
    baseRef.current = entry
    draftRef.current = next
    fieldsRef.current = entryFields
    setBase(entry)
    setTemplateBase(null)
    setDraft(next)
    queryClient.setQueryData(refModEntryQueryKey(entry.id), entry)
  }

  const changesFrom = (stored: RefModEntryDetail): Omit<RefModEntryPatch, 'revision'> | null => {
    const value = draftRef.current
    const storedFields = refModFormFields(stored.form, dropdownLists.data)
    const next = serialize(value, stored.form, storedFields)
    if (next.error) throw new Error(next.error)
    const before = serialize(refModDraftOf(stored, storedFields), stored.form, storedFields)
    if (next.key === before.key) return null
    const changes: Omit<RefModEntryPatch, 'revision'> = {}
    if (stored.form && next.values) changes.values = next.values
    if (!stored.form?.roles.name && value.name.trim() !== stored.name) changes.name = value.name.trim()
    if (JSON.stringify(value.keywords) !== JSON.stringify(stored.keywords)) changes.keywords = value.keywords
    return changes
  }
  const sameContent = (left: RefModEntryDetail, right: RefModEntryDetail) => {
    if (left.workflowId !== right.workflowId) return false
    const leftFields = refModFormFields(left.form, dropdownLists.data)
    const rightFields = refModFormFields(right.form, dropdownLists.data)
    return serialize(refModDraftOf(left, leftFields), left.form, leftFields).key === serialize(refModDraftOf(right, rightFields), right.form, rightFields).key
  }

  const saveNow = async (options: { register?: boolean } = {}) => {
    const sourceSession = sessionRef.current
    let stored = baseRef.current
    if (!stored) {
      const tpl = templateBaseRef.current
      if (!tpl) throw new Error(t({ ko: 'RefMod를 아직 불러오는 중이야.', en: 'The RefMod is still loading.' }))
      const value = draftRef.current
      const tplFields = refModFormFields(tpl.form, dropdownLists.data)
      const next = serialize(value, tpl.form, tplFields)
      if (next.error) throw new Error(next.error)
      const nameId = tpl.form?.roles.name ?? null
      const finalName = (nameId ? textOf(value.values[nameId]) : value.name).trim()
      setSaving(true)
      try {
        const created = await createRefModEntry({
          name: finalName,
          workflowId: tpl.workflowId,
          keywords: value.keywords,
          ...(tpl.form && next.values ? { values: next.values } : {}),
          ...(serverSeed?.conceptType && !tpl.form?.roles.concept ? { conceptType: serverSeed.conceptType } : {}),
          ...(serverSeed?.description && !tpl.form?.roles.description ? { description: serverSeed.description } : {}),
          registered: true,
        })
        void invalidateRefModEntries(queryClient, { entryIds: [created.id], listsChanged: true })
        if (sessionRef.current === sourceSession) {
          adopt(created)
          setConflict(null)
          setNameError(null)
          onCreated(created)
        }
        return created
      } catch (error) {
        if (isRefModNameConflict(error)) setNameError(getErrorMessage(error, t({ ko: '같은 이름의 RefMod가 있어.', en: 'A RefMod with this name exists.' })))
        throw error
      } finally {
        setSaving(false)
      }
    }
    setSaving(true)
    try {
      for (let attempt = 0; ; attempt += 1) {
        const changes = changesFrom(stored) ?? {}
        if (options.register && !stored.registered) changes.registered = true
        if (!Object.keys(changes).length) return stored
        try {
          const saved = await patchRefModEntry(stored.id, { ...changes, revision: stored.revision })
          void invalidateRefModEntries(queryClient, { entryIds: [saved.id], listsChanged: saved.name !== stored.name || saved.registered !== stored.registered })
          if (sessionRef.current === sourceSession) {
            adopt(saved)
            setConflict(null)
            setNameError(null)
          }
          return saved
        } catch (error) {
          if (isRefModNameConflict(error)) setNameError(getErrorMessage(error, t({ ko: '같은 이름의 RefMod가 있어.', en: 'A RefMod with this name exists.' })))
          if (attempt > 0 || !isRefModRevisionConflict(error)) throw error
          const newer = await getRefModEntry(stored.id)
          if (sessionRef.current !== sourceSession) throw new Error(t({ ko: '열린 RefMod가 바뀌어서 저장을 멈췄어.', en: 'The open RefMod changed, so the save was stopped.' }), { cause: error })
          if (!sameContent(newer, stored)) { setConflict(newer); throw error }
          baseRef.current = newer
          setBase(newer)
          stored = newer
        }
      }
    } finally {
      setSaving(false)
    }
  }
  const reportSaveError = (error: unknown) => {
    if (isRefModRevisionConflict(error) || isRefModNameConflict(error)) return
    showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  }
  const save = () => runBusy(async () => {
    try { return await saveNow() } catch (error) { reportSaveError(error); throw error }
  })
  const register = () => runBusy(async () => {
    try {
      const saved = await saveNow({ register: true })
      showSnackbar({ message: t({ ko: '‘{name}’을(를) 등록했어.', en: 'Registered ‘{name}’.' }, { name: saved.name }), tone: 'info' })
      return saved
    } catch (error) {
      reportSaveError(error)
      throw error
    }
  })

  const changeWorkflow = (workflowId: number | null) => runBusy(async () => {
    if (!baseRef.current) {
      setNewWorkflowId(workflowId)
      return
    }
    try {
      const before = await saveNow()
      if (before.workflowId === workflowId) return
      const oldIds = new Set(refModFormFields(before.form, dropdownLists.data).map((field) => field.id))
      setSaving(true)
      let saved: RefModEntryDetail
      try { saved = await patchRefModEntry(before.id, { revision: before.revision, workflowId }) } finally { setSaving(false) }
      void invalidateRefModEntries(queryClient, { entryIds: [saved.id] })
      if (!isCurrent()) return
      adopt(saved)
      const roles = new Set(Object.values(saved.form?.roles ?? {}).filter((id): id is string => typeof id === 'string'))
      const fallen = refModFormFields(saved.form, dropdownLists.data).filter((field) => !roles.has(field.id) && !oldIds.has(field.id)).length
      showSnackbar({
        message: fallen
          ? t({ ko: '워크플로를 바꿨어. 필드 {count}개는 기본값으로 돌아갔어.', en: 'Workflow changed. {count} fields went back to their defaults.' }, { count: fallen })
          : t({ ko: '워크플로를 바꿨어.', en: 'Workflow changed.' }),
        tone: 'info',
      })
    } catch (error) {
      if (isRefModRevisionConflict(error)) void query.refetch()
      reportSaveError(error)
    }
  })

  /**
   * Registered entry: move to 미등록 (keep config and file-store sources).
   * Unregistered entry (or forcePermanent): permanently delete entry, run records and file-store copies.
   */
  const remove = (ask: boolean, forcePermanent = false) => runBusy(async () => {
    const stored = baseRef.current
    if (!stored) return false
    const permanent = forcePermanent || !stored.registered
    if (ask) {
      const ok = permanent
        ? await confirm({
            title: t({ ko: '‘{name}’ 영구 삭제', en: 'Permanently delete ‘{name}’' }, { name: stored.name }),
            description: t({ ko: '항목과 파일함의 원본 파일·실행 기록을 모두 지워. 되돌릴 수 없어.', en: 'Deletes this RefMod, its file-store copies and run records permanently. This cannot be undone.' }),
            confirmLabel: t({ ko: '영구 삭제', en: 'Delete permanently' }),
            tone: 'destructive',
          })
        : await confirm({
            title: t({ ko: '‘{name}’ 미등록으로 이동', en: 'Move ‘{name}’ to Unregistered' }, { name: stored.name }),
            description: t({ ko: 'RefMod 목록에서 내리고 미등록으로 옮겨. 구성 정보와 파일함의 원본 파일은 유지돼.', en: 'Removes from RefMod list and moves to Unregistered. Configuration and source files in the file store stay.' }),
            confirmLabel: t({ ko: '미등록으로 이동', en: 'Move to Unregistered' }),
          })
      if (!ok) return false
    }
    setDeleting(true)
    try {
      if (permanent) {
        await deleteRefModEntry(stored.id, stored.revision)
        queryClient.removeQueries({ queryKey: refModEntryQueryKey(stored.id) })
      } else {
        await patchRefModEntry(stored.id, { revision: stored.revision, registered: false })
      }
      void invalidateRefModEntries(queryClient, { entryIds: [stored.id], listsChanged: true })
      if (baseRef.current?.id !== stored.id) return true
      deletedRef.current = true
      discardUploads(draftRef.current.values, stored)
      onClose()
      if (!permanent) showSnackbar({ message: t({ ko: '‘{name}’을(를) 미등록으로 옮겼어.', en: 'Moved ‘{name}’ to Unregistered.' }, { name: stored.name }), tone: 'info' })
      return true
    } catch (error) {
      if (isRefModRevisionConflict(error)) void query.refetch()
      showSnackbar({
        message: isRefModRevisionConflict(error)
          ? t({ ko: '다른 곳에서 이 RefMod가 바뀌었어. 지금 내용을 확인하고 다시 시도해줘.', en: 'This RefMod changed elsewhere. Check it and try again.' })
          : getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })),
        tone: 'error',
      })
      return false
    } finally {
      setDeleting(false)
    }
  })

  const setValues = (next: Record<string, WorkflowFieldDraftValue>) => {
    if (!isCurrent()) return
    draftRef.current = { ...draftRef.current, values: next }
    setDraft(draftRef.current)
  }
  const nameField = nameFieldId ? fields.find((field) => field.id === nameFieldId) : undefined
  const tooLong = nameValue.length > REFMOD_ENTRY_LIMITS.name
  return {
    target,
    entryId,
    isNew,
    serverSeed,
    recordPreview,
    open: target !== null,
    ready,
    session,
    isCurrent,
    busy: operations.session === session && operations.count > 0,
    isBusy: () => operationsRef.current.session === sessionRef.current && operationsRef.current.count > 0,
    onBusyChange,
    closeIfDeleted: (ids: number[]) => {
      const open = entryIdRef.current
      if (open !== null && ids.includes(open)) {
        deletedRef.current = true
        onClose()
      }
    },
    loading: (entryId !== null && !base && query.isPending) || (isNew && !templateBase && templateQuery.isPending),
    error: (entryId !== null && !base && query.isError ? query.error : null) ?? (isNew && !templateBase && templateQuery.isError ? templateQuery.error : null),
    retry: () => { if (entryId !== null) void query.refetch(); else if (isNew) void templateQuery.refetch() },
    refetch: () => query.refetch(),
    base,
    baseRef,
    templateBase,
    activeForm,
    activeWorkflowId: base ? base.workflowId : templateBase?.workflowId ?? null,
    latest,
    draft,
    draftRef,
    deletedRef,
    fields,
    dirty,
    draftError: current.error,
    nameValue,
    setName: (name: string) => {
      if (!isCurrent()) return
      setNameError(null)
      if (nameFieldId) setValues({ ...draftRef.current.values, [nameFieldId]: nameField?.type === 'textarea' ? [name] : name })
      else { draftRef.current = { ...draftRef.current, name }; setDraft(draftRef.current) }
    },
    nameError,
    setValue: (fieldId: string, value: WorkflowFieldDraftValue) => setValues({ ...draftRef.current.values, [fieldId]: value }),
    setKeywords: (keywords: string[]) => {
      if (!isCurrent()) return
      draftRef.current = { ...draftRef.current, keywords }
      setDraft(draftRef.current)
    },
    revert: () => {
      if (!isCurrent()) return
      const stored = baseRef.current
      if (stored) {
        const newest = query.data?.id === stored.id && query.data.revision > stored.revision ? query.data : stored
        discardUploads(draftRef.current.values, newest)
        adopt(newest)
        setConflict(null)
      } else if (templateBaseRef.current) {
        discardUploads(draftRef.current.values, null)
        const next = templateDraftOf(templateBaseRef.current, fieldsRef.current, serverSeed)
        draftRef.current = next
        setDraft(next)
        setNameError(null)
      }
    },
    conflict,
    reload: () => {
      if (!conflict || !isCurrent()) return
      discardUploads(draftRef.current.values, conflict)
      adopt(conflict)
      setConflict(null)
    },
    keepMine: () => {
      if (!conflict || !isCurrent() || conflict.workflowId !== baseRef.current?.workflowId) return
      baseRef.current = conflict
      setBase(conflict)
      setConflict(null)
    },
    canSave: ready && target?.kind !== 'record' && nameValue.trim().length > 0 && !tooLong && !current.error && !saving && !deleting,
    saving,
    deleting,
    save,
    register,
    changeWorkflow,
    remove,
  }
}

export type RefModEntryEditorState = ReturnType<typeof useRefModEntryEditor>
