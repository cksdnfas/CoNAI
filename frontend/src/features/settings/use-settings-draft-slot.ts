import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { areSettingsDraftsEqual, type SettingsDraftSection } from './settings-draft-sections'
import type { SettingsTab } from './settings-tabs'
import { useSettingsRevision } from './use-settings-revision'

/** One revision-checked settings draft and its page-wide save-bar section. */
export function useSettingsDraftSlot<T>({
  id,
  label,
  tab,
  saved,
  revision,
  update,
}: {
  id: string
  label: string
  tab: SettingsTab
  saved: T | null | undefined
  revision: string | undefined
  update: (draft: T, revision: string) => Promise<{ draft: T; sync: () => void }>
}) {
  const [draft, setDraft] = useState<T | null>(null)
  const effectiveDraft = draft ?? saved ?? null
  const isDirty = Boolean(effectiveDraft && saved && !areSettingsDraftsEqual(effectiveDraft, saved))
  const draftRevision = useSettingsRevision(revision, isDirty)
  const mutation = useMutation({
    mutationFn: (value: T) => update(value, draftRevision()),
    onSuccess: (result) => {
      result.sync()
      setDraft(result.draft)
    },
  })
  const section: SettingsDraftSection = {
    id,
    label,
    tab,
    isDirty,
    save: async () => {
      if (effectiveDraft) await mutation.mutateAsync(effectiveDraft)
    },
    discard: () => setDraft(null),
  }
  return { draft: effectiveDraft, setDraft, section }
}
