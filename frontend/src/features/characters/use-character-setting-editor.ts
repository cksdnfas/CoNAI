import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  characterSettingQueryKey,
  createCharacterSetting,
  deleteCharacterSetting,
  getCharacterSetting,
  getCharacterSettingDeletePreview,
  isCharacterRevisionConflict,
  updateCharacterSetting,
  type CharacterSetting,
} from '@/lib/api-character-library'
import { getErrorMessage } from '@/lib/error-message'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { emptySettingDraft, refreshCharacterViews, SETTING_DRAFT_KEYS, settingDraftOf, type SettingDraft } from './character-library-shared'

/** What the editor shows: a saved setting, or a new one being drafted in a folder. */
export type SettingEditorTarget = { settingId: number } | { newIn: number | null } | null

type DraftKey = keyof SettingDraft
const IMAGE_KEYS: ReadonlySet<DraftKey> = new Set(['referenceHash', 'avatarHash', 'avatarCrop'])
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/**
 * Put a draft edited from `previous` over a newer stored version: fields left alone follow `latest`, edited ones keep
 * the person's value. `conflicts` are edited fields that `latest` changed to something else.
 */
function mergeDraft(previous: SettingDraft, latest: SettingDraft, draft: SettingDraft) {
  const next = { ...latest }
  const conflicts: DraftKey[] = []
  for (const key of SETTING_DRAFT_KEYS) {
    if (same(draft[key], previous[key])) continue
    ;(next as Record<DraftKey, unknown>)[key] = draft[key]
    if (!same(latest[key], previous[key]) && !same(latest[key], draft[key])) conflicts.push(key)
  }
  return { draft: next, conflicts }
}

/**
 * The open setting editor's state, kept by the page so its assistant connection reads and fills the same draft.
 * `base` is the stored setting the draft started from; a save sends only the fields changed from it, with its
 * `revision`. A newer stored version (this editor's own image writes, or a change elsewhere) is taken under the draft
 * field by field; a save refused as stale re-reads it and retries once unless the same fields changed both ways.
 */
export function useCharacterSettingEditor({ target, onCreated, onClose }: {
  target: SettingEditorTarget
  /**
   * A new setting got its id (created so an image could be generated for it, or saved); the editor stays open on it.
   * A save of a saved setting keeps the editor open too.
   */
  onCreated: (setting: CharacterSetting) => void
  /** The setting is gone (deleted): leave its editor. */
  onClose: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  // Without images.view the stored hashes read as null and the server refuses image keys, so they are never sent.
  const { canViewImages } = useImagePermissions()
  const settingId = target && 'settingId' in target ? target.settingId : null
  const query = useQuery({ queryKey: characterSettingQueryKey(settingId ?? 0), queryFn: ({ signal }) => getCharacterSetting(settingId!, signal), enabled: settingId !== null })
  const [base, setBase] = useState<CharacterSetting | null>(null)
  const [initial, setInitial] = useState(() => emptySettingDraft(null))
  const [draft, setDraft] = useState(initial)
  const baseRef = useRef(base)
  baseRef.current = base
  const draftRef = useRef(draft)
  draftRef.current = draft

  const targetKey = !target ? '' : 'settingId' in target ? `setting:${target.settingId}` : `new:${target.newIn ?? 'root'}`
  const [loadedKey, setLoadedKey] = useState('')
  /** A draft the next load of its setting starts from (an undo bringing back edits made before a link change). */
  const [seeded, setSeeded] = useState<{ base: CharacterSetting; draft: SettingDraft } | null>(null)
  /** Counts opened new drafts, so each gets its own assistant resource. */
  const [draftSerial, setDraftSerial] = useState(0)
  // A new setting that was just created keeps its draft when the page switches to its id.
  if (loadedKey !== targetKey) {
    setLoadedKey(targetKey)
    if (targetKey.startsWith('new:')) setDraftSerial((count) => count + 1)
    if (!(loadedKey.startsWith('new:') && settingId !== null && base?.id === settingId)) {
      const fresh = emptySettingDraft(target && 'newIn' in target ? target.newIn : null)
      setBase(null)
      setInitial(fresh)
      setDraft(fresh)
    }
  }
  const dirty = target !== null && !same(draft, base ? settingDraftOf(base) : initial)
  const data = query.data
  if (data && data.id === settingId && loadedKey === targetKey) {
    if (base?.id !== data.id) {
      // A seeded draft starts from its own base: a newer stored version then goes under it (below) or, on a real
      // conflict, is held back so the save meets the stale revision and its conflict message.
      const fromSeed = seeded?.base.id === data.id ? seeded : null
      setBase(fromSeed ? fromSeed.base : data)
      setDraft(fromSeed ? fromSeed.draft : settingDraftOf(data))
      if (seeded) setSeeded(null)
    } else if (data.revision > base.revision) {
      // A newer stored version goes under the draft unless it changed a field the person is editing.
      const merged = mergeDraft(settingDraftOf(base), settingDraftOf(data), draft)
      if (!merged.conflicts.length) {
        setBase(data)
        setDraft(merged.draft)
      }
    }
  }
  const ready = target !== null && (settingId === null || base?.id === settingId)

  /** Make `latest` the base with `next` as the draft, right away (later steps in the same task read the refs). */
  const adopt = (latest: CharacterSetting, next: SettingDraft) => {
    baseRef.current = latest
    draftRef.current = next
    setBase(latest)
    setDraft(next)
    queryClient.setQueryData(characterSettingQueryKey(latest.id), latest)
  }

  /** Take a newer stored setting from this editor's own write: untouched fields follow it, edited ones stay. */
  const rebase = (latest: CharacterSetting, patch: Partial<SettingDraft> = {}) => {
    const previous = baseRef.current
    const merged = previous ? mergeDraft(settingDraftOf(previous), settingDraftOf(latest), draftRef.current).draft : settingDraftOf(latest)
    adopt(latest, { ...merged, ...patch })
  }

  /** The draft's changes from the stored version in `keys`, image keys only for people who see images. */
  const changesFrom = (current: CharacterSetting, keys: readonly DraftKey[]) => {
    const value = { ...draftRef.current, name: draftRef.current.name.trim() }
    const stored = settingDraftOf(current)
    const changes: Partial<SettingDraft> = {}
    for (const key of keys) {
      if ((canViewImages || !IMAGE_KEYS.has(key)) && !same(value[key], stored[key])) (changes as Record<DraftKey, unknown>)[key] = value[key]
    }
    return changes
  }

  const fieldLabel = (key: DraftKey) => ({
    name: t({ ko: '이름', en: 'name' }),
    folderId: t({ ko: '폴더', en: 'folder' }),
    appearance: t({ ko: '외형 설명', en: 'appearance' }),
    referenceHash: t({ ko: '기준 이미지', en: 'reference image' }),
    avatarHash: t({ ko: '아바타', en: 'avatar' }),
    avatarCrop: t({ ko: '아바타', en: 'avatar' }),
  })[key]
  const conflictMessage = (fields: DraftKey[]) => t(
    { ko: '다른 곳에서 같은 항목이 바뀌었어 ({fields}). 네가 고친 값은 그대로 뒀으니 확인하고 다시 저장해.', en: 'The same fields changed elsewhere ({fields}). Your edits are kept; check them and save again.' },
    { fields: [...new Set(fields.map(fieldLabel))].join(', ') },
  )

  /** Update the stored setting with the draft's changes in `keys`; a stale revision re-reads, merges and retries once. */
  const writeChanges = async (keys: readonly DraftKey[]) => {
    let current = baseRef.current!
    for (let attempt = 0; ; attempt += 1) {
      const changes = changesFrom(current, keys)
      if (!Object.keys(changes).length) return current
      try {
        return await updateCharacterSetting(current.id, { ...changes, revision: current.revision })
      } catch (error) {
        if (attempt > 0 || !isCharacterRevisionConflict(error)) throw error
        const latest = await getCharacterSetting(current.id)
        const merged = mergeDraft(settingDraftOf(current), settingDraftOf(latest), draftRef.current)
        adopt(latest, merged.draft)
        if (merged.conflicts.length) throw new Error(conflictMessage(merged.conflicts), { cause: error })
        current = latest
      }
    }
  }

  const createFromDraft = () => {
    const value = draftRef.current
    return createCharacterSetting({
      folderId: value.folderId,
      name: value.name.trim(),
      appearance: value.appearance,
      ...(canViewImages ? { referenceHash: value.referenceHash, avatarHash: value.avatarHash, avatarCrop: value.avatarCrop } : {}),
    })
  }

  /** Saves what image generation reads (name, appearance, reference); a new setting is created whole here. */
  const ensureSetting = async () => {
    if (!baseRef.current) {
      const created = await createFromDraft()
      rebase(created)
      void refreshCharacterViews(queryClient, { folderIds: [created.folderId], settingIds: [created.id] })
      onCreated(created)
      return created
    }
    const updated = await writeChanges(['name', 'appearance', 'referenceHash'])
    rebase(updated)
    return updated
  }

  const saveMutation = useMutation({
    mutationFn: () => baseRef.current ? writeChanges(SETTING_DRAFT_KEYS) : createFromDraft(),
    onSuccess: (saved) => {
      const created = !baseRef.current
      const previousFolder = baseRef.current?.folderId ?? saved.folderId
      adopt(saved, settingDraftOf(saved))
      void refreshCharacterViews(queryClient, { folderIds: [previousFolder, saved.folderId], settingIds: [saved.id] })
      // The editor page stays on the saved setting; a new one moves to its own address.
      if (created) onCreated(saved)
    },
    onError: (error) => showSnackbar({
      message: isCharacterRevisionConflict(error)
        ? t({ ko: '다른 곳에서 이 외형 설정이 계속 바뀌고 있어. 네가 고친 값은 그대로 뒀으니 잠시 뒤 다시 저장해.', en: 'This setting keeps changing elsewhere. Your edits are kept; save again in a moment.' })
        : getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })),
      tone: 'error',
    }),
  })

  const deleteMutation = useMutation({
    mutationFn: (setting: CharacterSetting) => deleteCharacterSetting(setting.id, setting.revision),
    onSuccess: (_, setting) => {
      queryClient.removeQueries({ queryKey: characterSettingQueryKey(setting.id) })
      void refreshCharacterViews(queryClient, { folderIds: [setting.folderId], settingIds: [setting.id] })
      onClose()
    },
    onError: (error) => {
      if (isCharacterRevisionConflict(error)) void query.refetch()
      showSnackbar({
        message: isCharacterRevisionConflict(error)
          ? t({ ko: '다른 곳에서 이 외형 설정이 바뀌었어. 지금 내용을 확인하고 다시 지워줘.', en: 'This setting changed elsewhere. Check it and delete again.' })
          : getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })),
        tone: 'error',
      })
    },
  })

  /** Delete the open setting; `ask` confirms with what goes with it (a chat's approved card has already asked). */
  const remove = async (ask: boolean) => {
    const current = baseRef.current
    if (!current) throw new Error(t({ ko: '저장된 외형 설정이 아니야.', en: 'This setting is not saved.' }))
    if (ask) {
      let preview
      try {
        preview = await getCharacterSettingDeletePreview(current.id)
      } catch (error) {
        showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제할 내용을 확인하지 못했어.', en: 'Could not check what gets deleted.' })), tone: 'error' })
        return
      }
      const linked = preview.linkedProfileCount
      const ok = await confirm({
        title: t({ ko: '외형 설정 삭제', en: 'Delete setting' }),
        description: [
          t({ ko: '‘{name}’ 설정을 지울까?', en: 'Delete ‘{name}’?' }, { name: current.name }),
          linked ? t({ ko: '연결된 프로필 {count}개는 지금 값의 사본을 유지해.', en: '{count} linked profiles keep a copy of its values.' }, { count: linked }) : '',
        ].filter(Boolean).join('\n'),
        confirmLabel: t({ ko: '삭제', en: 'Delete' }),
        tone: 'destructive',
      })
      if (!ok) return
    }
    await deleteMutation.mutateAsync(current)
  }

  return {
    target,
    open: target !== null,
    /** A new draft, or the stored setting has loaded (nothing to read or fill before that). */
    ready,
    /** Per opened new draft; with the setting id it names the assistant resource. */
    draftSerial,
    loading: settingId !== null && !base && query.isPending,
    error: settingId !== null && !base && query.isError ? query.error : null,
    retry: () => void query.refetch(),
    base,
    draft,
    /** The latest draft, for checks that run after this render (an assistant fill's undo). */
    draftRef,
    /** The latest stored setting the draft started from. */
    baseRef,
    /** Start the next load of `base`'s setting from `draft` (edits made over `base`), instead of the stored values. */
    seed: (seedBase: CharacterSetting, seedDraft: SettingDraft) => setSeeded({ base: seedBase, draft: seedDraft }),
    dirty,
    /** Change some fields of the draft (nothing is saved). */
    patch: (next: Partial<SettingDraft>) => setDraft((current) => ({ ...current, ...next })),
    rebase,
    ensureSetting,
    canSave: draft.name.trim().length > 0 && !saveMutation.isPending && !deleteMutation.isPending,
    saving: saveMutation.isPending,
    deleting: deleteMutation.isPending,
    save: () => saveMutation.mutateAsync(),
    /**
     * Store the draft's changes and stay open (a synced profile's save stores its setting first): only changed
     * fields with `revision`, the same once-retry and kept draft on a real conflict as `save`.
     */
    commit: async () => {
      const current = baseRef.current
      if (!current) throw new Error(t({ ko: '저장된 외형 설정이 아니야.', en: 'This setting is not saved.' }))
      const saved = await writeChanges(SETTING_DRAFT_KEYS)
      if (saved !== current) {
        rebase(saved)
        void refreshCharacterViews(queryClient, { folderIds: [current.folderId, saved.folderId], settingIds: [saved.id] })
      }
      return saved
    },
    remove,
  }
}

export type CharacterSettingEditorState = ReturnType<typeof useCharacterSettingEditor>
