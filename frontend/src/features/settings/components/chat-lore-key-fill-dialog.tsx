import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Sparkles, X } from 'lucide-react'
import { loreKeyLanguageLabel } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { CHAT_PROFILES_QUERY_KEY, fillLoreKeys, listChatProfiles, loreEntryTitle, type ChatLoreEntry } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'

/**
 * "빠진 키 채우기": a profile's model writes the key-language keywords of the entries that have none. Nothing goes
 * into the book until the person reviews the result and presses 넣기; the book itself is saved with its own button.
 */
export function ChatLoreKeyFillDialog({ open, language, entries, onApply, onClose }: {
  open: boolean
  language: string
  /** The entries missing keywords in `language`. */
  entries: ChatLoreEntry[]
  onApply: (keys: Record<string, string[]>) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const profilesQuery = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, enabled: open })
  const profiles = (profilesQuery.data ?? []).filter((profile) => profile.engine !== 'codex' && profile.usable)
  const [profileId, setProfileId] = useState<number | null>(null)
  const [result, setResult] = useState<Record<string, string[]>>({})
  const [failed, setFailed] = useState<string[]>([])
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const label = loreKeyLanguageLabel(language)

  useEffect(() => {
    if (!open) return
    setResult({})
    setFailed([])
    setSkipped(new Set())
  }, [open])
  useEffect(() => {
    if (profileId === null && profiles[0]) setProfileId(profiles[0].id)
  }, [profileId, profiles])

  const fillMutation = useMutation({
    mutationFn: () => fillLoreKeys({
      profileId: profileId as number,
      language,
      entries: entries.map((entry) => ({ id: entry.id, title: loreEntryTitle(entry), keys: entry.keys, content: entry.content })),
    }),
    onSuccess: (data) => { setResult(data.keys); setFailed(data.failed); setSkipped(new Set()) },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '키를 만들지 못했어.', en: 'Could not write the keywords.' })), tone: 'error' }),
  })

  const ready = entries.filter((entry) => (result[entry.id]?.length ?? 0) > 0)
  const chosen = ready.filter((entry) => !skipped.has(entry.id))
  const removeKey = (entryId: string, key: string) => setResult((current) => ({ ...current, [entryId]: (current[entryId] ?? []).filter((value) => value !== key) }))
  const toggle = (entryId: string, on: boolean) => setSkipped((current) => {
    const next = new Set(current)
    if (on) next.delete(entryId)
    else next.add(entryId)
    return next
  })

  return (
    <Modal open={open} onClose={onClose} title={t({ ko: '{language} 키 채우기', en: 'Fill {language} keywords' }, { language: label })} size="normal" height="medium">
      <ModalBody className="space-y-1">
        {fillMutation.isPending ? <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner className="size-4" />{t({ ko: '{count}개 항목의 키를 만드는 중', en: 'Writing keywords for {count} entries' }, { count: entries.length })}</div> : null}
        {!fillMutation.isPending && ready.length === 0 && failed.length === 0 ? (
          <div className="divide-y divide-line">
            {entries.map((entry) => <div key={entry.id} className="flex min-w-0 items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{loreEntryTitle(entry)}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{entry.keys.join(', ')}</span>
            </div>)}
          </div>
        ) : null}
        {!fillMutation.isPending && (ready.length > 0 || failed.length > 0) ? (
          <div className="divide-y divide-line">
            {ready.map((entry) => <div key={entry.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 py-2">
              <Checkbox checked={!skipped.has(entry.id)} onCheckedChange={(checked) => toggle(entry.id, checked === true)} aria-label={t({ ko: '{title}에 넣기', en: 'Add to {title}' }, { title: loreEntryTitle(entry) })} />
              <span className="min-w-0 truncate text-xs text-muted-foreground">{loreEntryTitle(entry)} · {entry.keys.join(', ')}</span>
              <span className="flex min-w-0 flex-wrap gap-1">
                {result[entry.id].map((key) => <Chip key={key}>{key}<IconButton size="icon-xs" variant="ghost" label={t({ ko: '키워드 삭제', en: 'Remove keyword' })} onClick={() => removeKey(entry.id, key)}><X /></IconButton></Chip>)}
              </span>
            </div>)}
            {failed.length > 0 ? <div className="py-2 text-xs text-muted-foreground">{t({ ko: '못 만든 항목 {count}개: {titles}', en: '{count} entries got none: {titles}' }, { count: failed.length, titles: entries.filter((entry) => failed.includes(entry.id)).map((entry) => loreEntryTitle(entry)).join(', ') })}</div> : null}
          </div>
        ) : null}
      </ModalBody>
      <ModalFooter className="mt-4 gap-1 border-t border-line pt-3">
        <IconButton size="icon-sm" variant="ghost" disabled={profileId === null || entries.length === 0 || fillMutation.isPending} onClick={() => fillMutation.mutate()} label={t({ ko: '{name}에게 맡기기', en: 'Ask {name}' }, { name: profiles.find((profile) => profile.id === profileId)?.name ?? '' })}>
          {fillMutation.isPending ? <Spinner className="size-3.5" /> : <Sparkles />}
        </IconButton>
        {profiles.length > 1 ? (
          <Select variant="settings" className="h-8 w-40 text-xs" value={profileId === null ? '' : String(profileId)} onChange={(event) => setProfileId(Number(event.target.value))} aria-label={t({ ko: '맡길 프로필', en: 'Profile to ask' })}>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </Select>
        ) : null}
        {profilesQuery.isSuccess && profiles.length === 0 ? <span className="text-xs text-muted-foreground">{t({ ko: '맡길 프로필이 없어', en: 'No profile to ask' })}</span> : null}
        <span className="flex-1" />
        <Button size="sm" disabled={chosen.length === 0} onClick={() => { onApply(Object.fromEntries(chosen.map((entry) => [entry.id, result[entry.id]]))); onClose() }}>
          {t({ ko: '{count}개 항목에 넣기', en: 'Add to {count} entries' }, { count: chosen.length })}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
