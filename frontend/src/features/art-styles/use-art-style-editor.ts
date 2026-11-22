import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ART_STYLE_LIMITS } from '@conai/shared'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import {
  artStyleQueryKey,
  createArtStyle,
  deleteArtStyle,
  getArtStyle,
  invalidateArtStyles,
  isArtStyleNameConflict,
  isArtStyleRevisionConflict,
  updateArtStyle,
  type ArtStyle,
  type ArtStyleCreateInput,
  type ArtStylePatch,
} from '@/lib/api-art-styles'
import { deleteWorkflowInputAsset, uploadWorkflowInputAsset, WORKFLOW_INPUT_ASSET_REF_KIND, type WorkflowInputAssetRef } from '@/lib/api-workflow-input-assets'
import { getErrorMessage } from '@/lib/error-message'

/**
 * One image of a draft, exactly as a save sends it: `{ id }` a copy the style holds; `{ composite_hash }` a library pick,
 * `{ file_id }` a file store pick and a staged upload (a workflow input asset), all copied into the style when it is saved.
 */
export type ArtStyleDraftImage = { id: string } | { composite_hash: string } | { file_id: string } | WorkflowInputAssetRef
export const isStagedArtStyleImage = (image: ArtStyleDraftImage): image is WorkflowInputAssetRef => '__ref' in image && image.__ref === WORKFLOW_INPUT_ASSET_REF_KIND
/** A draft image's key (unique in a draft): ids and hashes are told apart by their tag, never by their form. */
export const artStyleImageKey = (image: ArtStyleDraftImage) => isStagedArtStyleImage(image) ? `upload:${image.id}`
  : 'composite_hash' in image ? `hash:${image.composite_hash}` : 'file_id' in image ? `file:${image.file_id}` : `id:${image.id}`

/** The editable fields of one style (what a save sends). Favorite is set directly, never through the draft. */
export type ArtStyleDraft = {
  title: string
  description: string
  badges: string[]
  keywords: string[]
  positive: string
  negative: string
  images: ArtStyleDraftImage[]
}
export const ART_STYLE_DRAFT_KEYS = ['title', 'description', 'badges', 'keywords', 'positive', 'negative', 'images'] as const satisfies ReadonlyArray<keyof ArtStyleDraft>
type DraftKey = keyof ArtStyleDraft

export const emptyArtStyleDraft = (): ArtStyleDraft => ({ title: '', description: '', badges: [], keywords: [], positive: '', negative: '', images: [] })
export const artStyleDraftOf = (style: ArtStyle): ArtStyleDraft => ({ title: style.title, description: style.description, badges: style.badges, keywords: style.keywords, positive: style.positive, negative: style.negative, images: style.images.map(({ id }) => ({ id })) })
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/**
 * Put a draft edited from `previous` over a newer stored version: fields left alone follow `latest`, edited ones keep
 * the person's value. `conflicts` are edited fields that `latest` changed to something else.
 */
function mergeDraft(previous: ArtStyleDraft, latest: ArtStyleDraft, draft: ArtStyleDraft) {
  const next = { ...latest }
  const conflicts: DraftKey[] = []
  for (const key of ART_STYLE_DRAFT_KEYS) {
    if (same(draft[key], previous[key])) continue
    ;(next as Record<DraftKey, unknown>)[key] = draft[key]
    if (!same(latest[key], previous[key]) && !same(latest[key], draft[key])) conflicts.push(key)
  }
  return { draft: next, conflicts }
}

/**
 * The open style's editor, kept by the page so its assistant connection reads and fills the same draft. `base` is the
 * stored style the draft started from; a save sends only the fields changed from it with its `revision`. A newer stored
 * version (a favorite toggled in the list, another tab) goes under the draft field by field. A save refused as stale
 * re-reads and retries once; when the same fields changed both ways it stops and `conflict` offers a reload (or keeping
 * the draft over the newer version). A taken title is `titleError`, shown on the title. Uploads are staged (never a
 * library image) and deleted again when the draft that holds them is dropped unsaved (closed, stepped away, reverted).
 */
export type ArtStyleEditorTarget = { styleId: number } | { new: true } | null

export function useArtStyleEditor({ target, onCreated, onClose }: {
  target: ArtStyleEditorTarget
  onCreated: (style: ArtStyle) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  // Without images.view the stored list reads as empty and the server refuses `images`, so it is never sent.
  const { canViewImages } = useImagePermissions()
  const styleId = target && 'styleId' in target ? target.styleId : null
  const isNew = Boolean(target && 'new' in target)
  const targetKey = !target ? '' : 'styleId' in target ? `style:${target.styleId}` : 'new'
  const query = useQuery({ queryKey: artStyleQueryKey(styleId ?? 0), queryFn: ({ signal }) => getArtStyle(styleId!, signal), enabled: styleId !== null })
  const [base, setBase] = useState<ArtStyle | null>(null)
  const [draft, setDraft] = useState(emptyArtStyleDraft)
  const [conflict, setConflict] = useState<ArtStyle | null>(null)
  const [titleError, setTitleError] = useState<string | null>(null)
  const baseRef = useRef(base)
  baseRef.current = base
  const draftRef = useRef(draft)
  draftRef.current = draft
  const deletedRef = useRef(false)
  const styleIdRef = useRef(styleId)
  styleIdRef.current = styleId

  /** Uploads staged for the open style and not yet taken over by a save. */
  const stagedRef = useRef(new Set<string>())
  const discardStaged = (keep: ArtStyleDraftImage[] = []) => {
    const kept = new Set(keep.filter(isStagedArtStyleImage).map((image) => image.id))
    const ids = [...stagedRef.current].filter((id) => !kept.has(id))
    for (const id of ids) stagedRef.current.delete(id)
    if (ids.length) void Promise.allSettled(ids.map((id) => deleteWorkflowInputAsset(id)))
  }
  const discardStagedOnLeave = useRef(discardStaged)
  discardStagedOnLeave.current = discardStaged
  useEffect(() => () => discardStagedOnLeave.current(), [targetKey])

  const sessionRef = useRef(0)
  const operationsRef = useRef({ session: 0, count: 0 })
  const [operations, setOperations] = useState(operationsRef.current)
  const [loadedKey, setLoadedKey] = useState('')
  if (loadedKey !== targetKey) {
    setLoadedKey(targetKey)
    deletedRef.current = false
    if (!(loadedKey === 'new' && styleId !== null && base?.id === styleId)) {
      sessionRef.current += 1
      setBase(null)
      setDraft(emptyArtStyleDraft())
      setConflict(null)
      setTitleError(null)
    }
  }
  const data = query.data
  if (data && data.id === styleId && loadedKey === targetKey) {
    if (base?.id !== data.id) {
      setBase(data)
      setDraft(artStyleDraftOf(data))
    } else if (data.revision > base.revision) {
      // A newer stored version goes under the draft unless it changed a field the person is editing.
      const merged = mergeDraft(artStyleDraftOf(base), artStyleDraftOf(data), draft)
      if (!merged.conflicts.length) {
        setBase(data)
        setDraft(merged.draft)
      }
    }
  }
  const ready = target !== null && (styleId === null || base?.id === styleId)
  const dirty = ready && !same(draft, base ? artStyleDraftOf(base) : emptyArtStyleDraft())
  const session = sessionRef.current
  const isCurrent = () => sessionRef.current === session
  const onBusyChange = (busy: boolean) => {
    if (!isCurrent()) return
    const count = operationsRef.current.session === session ? operationsRef.current.count : 0
    operationsRef.current = { session, count: Math.max(0, count + (busy ? 1 : -1)) }
    setOperations(operationsRef.current)
  }
  const runBusy = async <T,>(task: () => Promise<T>) => {
    if (!isCurrent()) throw new Error(t({ ko: '편집 중인 스타일이 바뀌었어.', en: 'The open style changed.' }))
    onBusyChange(true)
    try { return await task() } finally { onBusyChange(false) }
  }

  /** Make `latest` the base with `next` as the draft, right away (later steps in the same task read the refs). */
  const adopt = (latest: ArtStyle, next: ArtStyleDraft) => {
    baseRef.current = latest
    draftRef.current = next
    setBase(latest)
    setDraft(next)
    queryClient.setQueryData(artStyleQueryKey(latest.id), latest)
  }
  const changesFrom = (current: ArtStyle) => {
    const value = { ...draftRef.current, title: draftRef.current.title.trim() }
    const stored = artStyleDraftOf(current)
    const changes: Partial<ArtStyleDraft> = {}
    for (const key of ART_STYLE_DRAFT_KEYS) {
      if ((canViewImages || key !== 'images') && !same(value[key], stored[key])) (changes as Record<DraftKey, unknown>)[key] = value[key]
    }
    return changes
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const sourceSession = sessionRef.current
      let current = baseRef.current
      if (!current) {
        const submitted = draftRef.current
        const payload: ArtStyleCreateInput = {
          title: submitted.title.trim(),
          description: submitted.description,
          badges: submitted.badges,
          keywords: submitted.keywords,
          positive: submitted.positive,
          negative: submitted.negative,
          ...(canViewImages && submitted.images.length ? { images: submitted.images } : {}),
        }
        return { saved: await createArtStyle(payload), submitted, sourceSession, created: true }
      }
      for (let attempt = 0; ; attempt += 1) {
        const submitted = draftRef.current
        const changes = changesFrom(current)
        if (!Object.keys(changes).length) return { saved: current, submitted, sourceSession, created: false }
        try {
          return { saved: await updateArtStyle(current.id, { ...changes, revision: current.revision } satisfies ArtStylePatch), submitted, sourceSession, created: false }
        } catch (error) {
          if (attempt > 0 || !isArtStyleRevisionConflict(error)) throw error
          const latest = await getArtStyle(current.id)
          if (sessionRef.current !== sourceSession) throw new Error(t({ ko: '편집 중인 스타일이 바뀌어서 저장을 멈췄어.', en: 'The open style changed, so the save was stopped.' }), { cause: error })
          const merged = mergeDraft(artStyleDraftOf(current), artStyleDraftOf(latest), draftRef.current)
          if (merged.conflicts.length) { setConflict(latest); throw error }
          adopt(latest, merged.draft)
          current = latest
        }
      }
    },
    onSuccess: ({ saved, submitted, sourceSession, created }) => {
      void invalidateArtStyles(queryClient, { styleIds: [saved.id], listsChanged: created })
      // The save took over (and consumed) the uploads it sent.
      for (const image of submitted.images) if (isStagedArtStyleImage(image)) stagedRef.current.delete(image.id)
      if (sessionRef.current !== sourceSession) return
      // The server trims and dedupes: fields left alone since the save take its values, so the draft reads as saved.
      adopt(saved, mergeDraft(submitted, artStyleDraftOf(saved), draftRef.current).draft)
      setConflict(null)
      setTitleError(null)
      if (created) onCreated(saved)
    },
    onError: (error) => {
      if (isArtStyleNameConflict(error)) { setTitleError(getErrorMessage(error, t({ ko: '같은 이름의 스타일이 있어.', en: 'A style with this title exists.' }))); return }
      if (isArtStyleRevisionConflict(error)) return // `conflict` offers the way out.
      showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (style: ArtStyle) => deleteArtStyle(style.id, style.revision),
    onSuccess: (_, style) => {
      queryClient.removeQueries({ queryKey: artStyleQueryKey(style.id) })
      void invalidateArtStyles(queryClient, { styleIds: [style.id], listsChanged: true })
      if (baseRef.current?.id !== style.id) return
      deletedRef.current = true
      onClose()
    },
    onError: (error) => {
      if (isArtStyleRevisionConflict(error)) void query.refetch()
      showSnackbar({
        message: isArtStyleRevisionConflict(error)
          ? t({ ko: '다른 곳에서 이 스타일이 바뀌었어. 지금 내용을 확인하고 다시 지워줘.', en: 'This style changed elsewhere. Check it and delete again.' })
          : getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })),
        tone: 'error',
      })
    },
  })

  /** Delete the open style with its reference images; `ask` confirms first (a chat's approved card has already asked). */
  const remove = async (ask: boolean) => {
    const current = baseRef.current
    if (!current) throw new Error(t({ ko: '스타일을 아직 불러오는 중이야.', en: 'The style is still loading.' }))
    if (ask && !await confirm({
      title: t({ ko: '‘{name}’ 삭제', en: 'Delete ‘{name}’' }, { name: current.title }),
      description: t({ ko: '스타일과 참조 이미지가 함께 지워져.', en: 'The style and its reference images are deleted.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })) return
    await deleteMutation.mutateAsync(current)
  }

  const tooLong = draft.title.length > ART_STYLE_LIMITS.title || draft.description.length > ART_STYLE_LIMITS.description
    || draft.positive.length > ART_STYLE_LIMITS.prompt || draft.negative.length > ART_STYLE_LIMITS.prompt
  return {
    styleId,
    isNew,
    open: target !== null,
    /** The stored style has loaded (or a brand-new draft is open). */
    ready,
    session,
    isCurrent,
    busy: operations.session === session && operations.count > 0,
    isBusy: () => operationsRef.current.session === sessionRef.current && operationsRef.current.count > 0,
    onBusyChange,
    closeIfDeleted: (ids: number[]) => {
      const current = styleIdRef.current
      if (current !== null && ids.includes(current)) {
        deletedRef.current = true
        onClose()
      }
    },
    loading: styleId !== null && !base && query.isPending,
    error: styleId !== null && !base && query.isError ? query.error : null,
    retry: () => void query.refetch(),
    base,
    draft,
    /** The latest draft, for checks that run after this render (an assistant fill's undo). */
    draftRef,
    /** The latest stored style the draft started from. */
    baseRef,
    /** A successful delete can leave the removed style without a second discard prompt. */
    deletedRef,
    dirty,
    /** Change some fields of the draft (nothing is saved). */
    patch: (next: Partial<ArtStyleDraft>) => {
      if (!isCurrent()) return
      draftRef.current = { ...draftRef.current, ...next }
      setDraft(draftRef.current)
      if (next.title !== undefined) setTitleError(null)
    },
    /** Put the draft back to the stored style (or empty for a new draft); staged uploads are deleted. */
    revert: () => { if (isCurrent()) { draftRef.current = baseRef.current ? artStyleDraftOf(baseRef.current) : emptyArtStyleDraft(); setDraft(draftRef.current); setTitleError(null); discardStaged() } },
    /**
     * Stage image files (never a library import) and append them to the draft as they land; a 저장 copies them into the
     * style. Stops at the image limit or when the open style changes (an upload that lands late is deleted).
     */
    stageUploads: (files: File[]) => runBusy(async () => {
      for (const file of files) {
        if (!isCurrent() || draftRef.current.images.length >= ART_STYLE_LIMITS.images) break
        const asset = await uploadWorkflowInputAsset(file)
        if (!isCurrent()) { void deleteWorkflowInputAsset(asset.id).catch(() => undefined); break }
        stagedRef.current.add(asset.id)
        draftRef.current = { ...draftRef.current, images: [...draftRef.current.images, asset] }
        setDraft(draftRef.current)
      }
    }).catch((error: unknown) => { showSnackbar({ message: getErrorMessage(error, t({ ko: '이미지를 올리지 못했어.', en: 'Could not upload the image.' })), tone: 'error' }) }),
    titleError,
    /** A save met a newer version that changed the same fields: the newer stored style. */
    conflict,
    /** Drop the draft and take the newer version. */
    reload: () => { if (conflict && isCurrent()) { adopt(conflict, artStyleDraftOf(conflict)); setConflict(null); discardStaged() } },
    /** Keep the edited fields over the newer version (its revision); the next save writes them. */
    keepMine: () => {
      const previous = baseRef.current
      if (!conflict || !previous || !isCurrent()) return
      // Only the edited fields stay; the rest follow the newer version, so the next save writes just the edits.
      adopt(conflict, mergeDraft(artStyleDraftOf(previous), artStyleDraftOf(conflict), draftRef.current).draft)
      setConflict(null)
    },
    canSave: ready && draft.title.trim().length > 0 && !tooLong && !saveMutation.isPending && !deleteMutation.isPending,
    saving: saveMutation.isPending,
    deleting: deleteMutation.isPending,
    save: () => runBusy(() => saveMutation.mutateAsync()),
    remove: (ask: boolean) => runBusy(() => remove(ask)),
  }
}

export type ArtStyleEditorState = ReturnType<typeof useArtStyleEditor>
