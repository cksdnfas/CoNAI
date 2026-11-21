import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { REFMOD_ENTRY_LIMITS } from '@conai/shared'
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
  deleteRefModEntry,
  getRefModEntry,
  invalidateRefModEntries,
  isRefModNameConflict,
  isRefModRevisionConflict,
  patchRefModEntry,
  refModEntryQueryKey,
  type RefModEntryDetail,
  type RefModEntryPatch,
} from '@/lib/api-refmod-entries'
import { deleteWorkflowInputAsset } from '@/lib/api-workflow-input-assets'
import { getErrorMessage } from '@/lib/error-message'

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
export function refModFormFields(entry: RefModEntryDetail | null, dropdownLists: readonly CustomDropdownList[] | undefined): WorkflowMarkedField[] {
  if (!entry?.form) return []
  const byName = new Map((dropdownLists ?? []).map((list) => [list.name, list]))
  return resolveVisibleWorkflowFields(entry.form.fields as unknown as WorkflowMarkedField[], byName)
}

/** The stored entry as a draft: its composed values turned back into the tab's draft (image fields keep their value). */
export function refModDraftOf(entry: RefModEntryDetail, fields: WorkflowMarkedField[]): RefModEntryDraft {
  const stored = entry.form?.values ?? {}
  const images = Object.fromEntries(fields.flatMap((field) => (field.type === 'image' ? isImageDraft(stored[field.id]) : (field.type === 'audio' || field.type === 'video') && isRecord(stored[field.id])) ? [[field.id, stored[field.id] as WorkflowFieldDraftValue]] : []))
  const values = entry.form ? buildComfyDraftFromHistoryPayload({ prompt_data: stored }, fields, images)?.draft ?? {} : {}
  return { name: entry.name, keywords: entry.keywords, values }
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

/**
 * A Director value as the dirty check compares it: normalized the way every Director edit rewrites it (so an untouched
 * stored value equals the Director's first rewrite of it) and without the measured source size and length. Opening an
 * entry makes the Director fill those in as its media loads, which also moves a canvas-derived width and height; that
 * alone is not an edit. `stored` is the entry's stored value of the same field: a width and height that only follow the
 * canvas compare as the stored ones, while a typed width or height still counts.
 */
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

/**
 * The open RefMod entry's editor, held by the page hook so the page assistant (stage B3) reads and fills the same draft.
 * `base` is the stored entry the draft started from; the form is the linked workflow's REAL form (fields, values and
 * roles from the server, never re-derived here). A save sends the whole form with `revision`; the answer (sources now
 * the entry's own file-store copies) replaces the draft. A stale save re-reads: when only favorite or runs changed it
 * retries, otherwise `conflict` offers reload or overwrite. Attachments dropped with an unsaved draft are deleted.
 */
export function useRefModEntryEditor({ entryId, onClose }: { entryId: number | null; onClose: () => void }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const [pendingRefetch, setPendingRefetch] = useState(false)
  const query = useQuery({
    queryKey: refModEntryQueryKey(entryId ?? 0),
    queryFn: ({ signal }) => getRefModEntry(entryId!, signal),
    enabled: entryId !== null,
    // A run still exporting finishes on the server; a slow re-read picks up its record.
    refetchInterval: pendingRefetch ? 15_000 : false,
  })
  const dropdownLists = useQuery({
    queryKey: ['image-generation-custom-dropdown-lists'],
    queryFn: () => getGenerationCustomDropdownLists(),
    enabled: entryId !== null && permissions.canViewWorkflows,
    staleTime: 60_000,
  })
  const [base, setBase] = useState<RefModEntryDetail | null>(null)
  const [draft, setDraft] = useState<RefModEntryDraft>(EMPTY_DRAFT)
  const [conflict, setConflict] = useState<RefModEntryDetail | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fields = refModFormFields(base, dropdownLists.data)
  const baseRef = useRef(base)
  baseRef.current = base
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
  const [loadedId, setLoadedId] = useState<number | null>(null)
  if (loadedId !== entryId) {
    setLoadedId(entryId)
    sessionRef.current += 1
    deletedRef.current = false
    setBase(null)
    setDraft(EMPTY_DRAFT)
    setConflict(null)
    setNameError(null)
  }

  /** Comparable form of a draft (images by identity, not their base64), and why it cannot be sent. */
  const serialize = (value: RefModEntryDraft, entry: RefModEntryDetail | null, entryFields: WorkflowMarkedField[]) => {
    const namedByField = Boolean(entry?.form?.roles.name)
    try {
      const values = entry?.form ? refModFormValues(entryFields, value.values) : null
      return { key: getImageDraftRevision({ values: comparableFormValues(entryFields, values, entry?.form?.values ?? {}), name: namedByField ? null : value.name.trim(), keywords: value.keywords }), values, error: null as string | null }
    } catch (error) {
      return { key: `invalid:${Math.random()}`, values: null, error: getErrorMessage(error, t({ ko: '숫자 입력을 확인해줘.', en: 'Check the number inputs.' })) }
    }
  }

  const data = query.data
  if (data && data.id === entryId && loadedId === entryId) {
    if (base?.id !== data.id) {
      setBase(data)
      setDraft(refModDraftOf(data, refModFormFields(data, dropdownLists.data)))
    } else if (data.revision > base.revision && !conflict) {
      // A newer stored version replaces an untouched draft; an edited one keeps going and the save sorts it out.
      const baseDraft = refModDraftOf(base, fields)
      if (serialize(draft, base, fields).key === serialize(baseDraft, base, fields).key) {
        setBase(data)
        setDraft(refModDraftOf(data, refModFormFields(data, dropdownLists.data)))
      }
    }
  }
  const ready = entryId !== null && base?.id === entryId
  /** The freshest stored state for status, runs, issues and favorite (the draft's own base may be older). */
  const latest = ready && data?.id === entryId && data.revision >= base.revision ? data : base
  const current = serialize(draft, base, fields)
  const dirty = ready && current.key !== serialize(refModDraftOf(base, fields), base, fields).key
  const nameFieldId = base?.form?.roles.name ?? null
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

  // Attachments uploaded into a draft that is dropped unsaved (closed, stepped away, reverted) are deleted.
  const discardUploads = (values: Record<string, WorkflowFieldDraftValue>, stored: RefModEntryDetail | null) => {
    const ids = newInputAssetIds(values, stored ? refModDraftOf(stored, fieldsRef.current).values : {})
    if (ids.length) void Promise.allSettled(ids.map((id) => deleteWorkflowInputAsset(id)))
  }
  const discardUploadsOnLeave = useRef(discardUploads)
  discardUploadsOnLeave.current = discardUploads
  // The last committed draft: when the open entry changes, the render has already reset the refs to the next one.
  const committed = useRef({ values: draft.values, base })
  useEffect(() => { committed.current = { values: draft.values, base } })
  useEffect(() => () => discardUploadsOnLeave.current(committed.current.values, committed.current.base), [entryId])

  /** Make `entry` the base with its own draft, right away (later steps of the same task read the refs). */
  const adopt = (entry: RefModEntryDetail) => {
    const entryFields = refModFormFields(entry, dropdownLists.data)
    const next = refModDraftOf(entry, entryFields)
    baseRef.current = entry
    draftRef.current = next
    fieldsRef.current = entryFields
    setBase(entry)
    setDraft(next)
    queryClient.setQueryData(refModEntryQueryKey(entry.id), entry)
  }

  const changesFrom = (stored: RefModEntryDetail): Omit<RefModEntryPatch, 'revision'> | null => {
    const value = draftRef.current
    const storedFields = refModFormFields(stored, dropdownLists.data)
    const next = serialize(value, stored, storedFields)
    if (next.error) throw new Error(next.error)
    const before = serialize(refModDraftOf(stored, storedFields), stored, storedFields)
    if (next.key === before.key) return null
    const changes: Omit<RefModEntryPatch, 'revision'> = {}
    if (stored.form && next.values) changes.values = next.values
    if (!stored.form?.roles.name && value.name.trim() !== stored.name) changes.name = value.name.trim()
    if (JSON.stringify(value.keywords) !== JSON.stringify(stored.keywords)) changes.keywords = value.keywords
    return changes
  }
  const sameContent = (left: RefModEntryDetail, right: RefModEntryDetail) => {
    if (left.workflowId !== right.workflowId) return false
    const leftFields = refModFormFields(left, dropdownLists.data)
    const rightFields = refModFormFields(right, dropdownLists.data)
    return serialize(refModDraftOf(left, leftFields), left, leftFields).key === serialize(refModDraftOf(right, rightFields), right, rightFields).key
  }

  const saveNow = async () => {
    let stored = baseRef.current
    if (!stored) throw new Error(t({ ko: 'RefMod를 아직 불러오는 중이야.', en: 'The RefMod is still loading.' }))
    const sourceSession = sessionRef.current
    setSaving(true)
    try {
      for (let attempt = 0; ; attempt += 1) {
        const changes = changesFrom(stored)
        if (!changes) return stored
        try {
          const saved = await patchRefModEntry(stored.id, { ...changes, revision: stored.revision })
          // A rename changes the set of names (the server-only rows are the server's names minus the entries').
          void invalidateRefModEntries(queryClient, { entryIds: [saved.id], listsChanged: saved.name !== stored.name })
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
          // Only favorite, runs or the server's status moved: the same save goes on over the newer revision.
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
    if (isRefModRevisionConflict(error) || isRefModNameConflict(error)) return // `conflict` / `nameError` show it.
    showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  }
  const save = () => runBusy(async () => {
    try { return await saveNow() } catch (error) { reportSaveError(error); throw error }
  })

  /** Link another creation workflow. An unsaved draft is saved first; the server keeps role values and same-id fields. */
  const changeWorkflow = (workflowId: number | null) => runBusy(async () => {
    try {
      const before = await saveNow()
      if (before.workflowId === workflowId) return
      const oldIds = new Set(refModFormFields(before, dropdownLists.data).map((field) => field.id))
      setSaving(true)
      let saved: RefModEntryDetail
      try { saved = await patchRefModEntry(before.id, { revision: before.revision, workflowId }) } finally { setSaving(false) }
      void invalidateRefModEntries(queryClient, { entryIds: [saved.id] })
      if (!isCurrent()) return
      adopt(saved)
      const roles = new Set(Object.values(saved.form?.roles ?? {}).filter((id): id is string => typeof id === 'string'))
      const fallen = refModFormFields(saved, dropdownLists.data).filter((field) => !roles.has(field.id) && !oldIds.has(field.id)).length
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

  /** Delete the open entry; `ask` confirms first. Its sources and run records go; the ComfyUI file stays. */
  const remove = (ask: boolean) => runBusy(async () => {
    const stored = baseRef.current
    if (!stored) return false
    if (ask && !await confirm({
      title: t({ ko: '‘{name}’ 삭제', en: 'Delete ‘{name}’' }, { name: stored.name }),
      description: t({ ko: '원본과 실행 기록도 같이 지워져. ComfyUI에 저장된 RefMod 파일은 남아.', en: 'Its sources and run records go too. The RefMod file saved in ComfyUI stays.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })) return false
    setDeleting(true)
    try {
      await deleteRefModEntry(stored.id, stored.revision)
      queryClient.removeQueries({ queryKey: refModEntryQueryKey(stored.id) })
      void invalidateRefModEntries(queryClient, { entryIds: [stored.id], listsChanged: true })
      if (baseRef.current?.id !== stored.id) return true
      deletedRef.current = true
      discardUploads(draftRef.current.values, stored)
      onClose()
      return true
    } catch (error) {
      if (isRefModRevisionConflict(error)) void query.refetch()
      showSnackbar({
        message: isRefModRevisionConflict(error)
          ? t({ ko: '다른 곳에서 이 RefMod가 바뀌었어. 지금 내용을 확인하고 다시 지워줘.', en: 'This RefMod changed elsewhere. Check it and delete again.' })
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
    entryId,
    open: entryId !== null,
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
    loading: entryId !== null && !base && query.isPending,
    error: entryId !== null && !base && query.isError ? query.error : null,
    retry: () => void query.refetch(),
    refetch: () => query.refetch(),
    /** The stored entry the draft started from. */
    base,
    baseRef,
    /** The freshest stored state (status, runs, issues, favorite). */
    latest,
    draft,
    draftRef,
    deletedRef,
    /** The form's fields as the generation page shows them. */
    fields,
    dirty,
    /** Why the draft cannot be sent (an invalid number), shown with the form. */
    draftError: current.error,
    /** The header name: the name role field when the workflow has one, else the entry name. */
    nameValue,
    setName: (name: string) => {
      if (!isCurrent()) return
      setNameError(null)
      if (nameFieldId) setValues({ ...draftRef.current.values, [nameFieldId]: nameField?.type === 'textarea' ? [name] : name })
      else { draftRef.current = { ...draftRef.current, name }; setDraft(draftRef.current) }
    },
    nameError,
    /** Change one form field (nothing is saved). */
    setValue: (fieldId: string, value: WorkflowFieldDraftValue) => setValues({ ...draftRef.current.values, [fieldId]: value }),
    setKeywords: (keywords: string[]) => {
      if (!isCurrent()) return
      draftRef.current = { ...draftRef.current, keywords }
      setDraft(draftRef.current)
    },
    /** Put the draft back to the stored entry, its newest version (new attachments are deleted). */
    revert: () => {
      const stored = baseRef.current
      if (!stored || !isCurrent()) return
      const newest = query.data?.id === stored.id && query.data.revision > stored.revision ? query.data : stored
      discardUploads(draftRef.current.values, newest)
      adopt(newest)
      setConflict(null)
    },
    conflict,
    /** Drop the draft and take the newer version. */
    reload: () => {
      if (!conflict || !isCurrent()) return
      discardUploads(draftRef.current.values, conflict)
      adopt(conflict)
      setConflict(null)
    },
    /** Keep the draft over the newer version (same workflow only); the next save writes it. */
    keepMine: () => {
      if (!conflict || !isCurrent() || conflict.workflowId !== baseRef.current?.workflowId) return
      baseRef.current = conflict
      setBase(conflict)
      setConflict(null)
    },
    canSave: ready && nameValue.trim().length > 0 && !tooLong && !current.error && !saving && !deleting,
    saving,
    deleting,
    save,
    changeWorkflow,
    remove,
  }
}

export type RefModEntryEditorState = ReturnType<typeof useRefModEntryEditor>
