import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Sparkles, TriangleAlert } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  CHAT_LOREBOOKS_QUERY_KEY,
  LoreDecisionsNeededError,
  OWN_LOREBOOKS_QUERY_KEY,
  draftLorebookMerge,
  listOwnLorebooks,
  loreEntryTitle,
  mergeLorebook,
  previewLorebookMerge,
  type LoreMergeChoice,
  type LoreMergeDecision,
  type LoreMergePreview,
  type LoreMergeResult,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

type Choice = { choice: LoreMergeChoice; content: string }

export type LorebookMergeDialogProps = {
  open: boolean
  /** The book whose entries go in (a chat book, or an account book). */
  sourceId: number
  /** The account book they go into; without one the dialog asks for it. */
  targetId?: number | null
  /** Only these source entries (승격). */
  entryIds?: string[]
  /** Remove the source once merged. */
  deleteSource?: boolean
  /** A preview already in hand (a chat deletion that stopped for decisions). */
  initialPreview?: LoreMergePreview | null
  /** Whose model "맡기기" uses: the chat's profile, or a room's members. */
  profiles: Array<{ id: number; name: string }>
  defaultProfileId?: number | null
  /** Takes the decisions instead of merging here (a chat deletion retries with them). */
  onSubmit?: (decisions: LoreMergeDecision[]) => Promise<void>
  onMerged: (result: LoreMergeResult | null) => void
  onClose: () => void
}

/** D: merge a book's entries into an account book, deciding each duplicate side by side. */
export function LorebookMergeDialog(props: LorebookMergeDialogProps) {
  const { t } = useI18n()
  const [targetName, setTargetName] = useState<string | null>(null)
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={targetName ? t({ ko: '{name}에 병합', en: 'Merge into {name}' }, { name: targetName }) : t({ ko: '병합', en: 'Merge' })}
      widthClassName="max-w-3xl"
    >
      {props.open ? <MergeBody {...props} onTargetName={setTargetName} /> : null}
    </Modal>
  )
}

function MergeBody({ sourceId, targetId: fixedTargetId, entryIds, deleteSource, initialPreview, profiles, defaultProfileId, onSubmit, onMerged, onClose, onTargetName }: LorebookMergeDialogProps & { onTargetName: (name: string | null) => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [targetId, setTargetId] = useState<number | null>(fixedTargetId ?? initialPreview?.target.id ?? null)
  const [override, setOverride] = useState<LoreMergePreview | null>(initialPreview ?? null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<number | null>(defaultProfileId ?? profiles[0]?.id ?? null)
  // "맡기기" instruction: null until the person opens the field, then their text (sent in place of the default).
  const [instruction, setInstruction] = useState<string | null>(null)
  const [instructionOpen, setInstructionOpen] = useState(false)

  const booksQuery = useQuery({ queryKey: OWN_LOREBOOKS_QUERY_KEY, queryFn: listOwnLorebooks, enabled: fixedTargetId == null && !initialPreview })
  const targets = (booksQuery.data ?? []).filter((book) => book.kind === 'account' && book.id !== sourceId)
  const entryKey = entryIds?.join(',') ?? ''
  const previewQuery = useQuery({
    queryKey: ['lore-merge-preview', sourceId, targetId, entryKey],
    queryFn: () => previewLorebookMerge(targetId as number, { sourceId, ...(entryIds ? { entryIds } : {}) }),
    enabled: targetId !== null && override === null,
    staleTime: 0,
    gcTime: 0,
  })
  const preview = override ?? previewQuery.data ?? null
  const duplicates = useMemo(() => preview?.items.filter((item) => item.status === 'duplicate') ?? [], [preview])

  useEffect(() => {
    onTargetName(preview?.target.name ?? targets.find((book) => book.id === targetId)?.name ?? null)
  }, [preview, targets, targetId, onTargetName])

  // Each duplicate starts on "합친 결과" with both texts; a new preview keeps what was already decided.
  useEffect(() => {
    if (!preview) return
    setChoices((current) => Object.fromEntries(preview.items.filter((item) => item.status === 'duplicate').map((item) => [item.entry.id, current[item.entry.id] ?? { choice: 'merged' as const, content: item.suggested ?? item.entry.content }])))
    setSelectedId((current) => (current && preview.items.some((item) => item.entry.id === current && item.status === 'duplicate') ? current : preview.items.find((item) => item.status === 'duplicate')?.entry.id ?? null))
  }, [preview])

  const decisions = (): LoreMergeDecision[] => duplicates.map((item) => {
    const choice = choices[item.entry.id] ?? { choice: 'merged', content: item.suggested ?? '' }
    return choice.choice === 'merged' ? { entryId: item.entry.id, choice: 'merged', content: choice.content } : { entryId: item.entry.id, choice: choice.choice }
  })
  const changing = (preview?.items ?? []).filter((item) => item.status === 'new' || choices[item.entry.id]?.choice !== 'target').length
  const emptyMerged = duplicates.some((item) => choices[item.entry.id]?.choice === 'merged' && !choices[item.entry.id]?.content.trim())

  const draftMutation = useMutation({
    mutationFn: () => draftLorebookMerge(targetId as number, {
      sourceId,
      profileId: profileId as number,
      entryIds: duplicates.map((item) => item.entry.id),
      ...(instruction !== null && instruction.trim() ? { instruction: instruction.trim() } : {}),
    }),
    onSuccess: ({ drafts }) => {
      const nextErrors: Record<string, string> = {}
      setChoices((current) => {
        const next = { ...current }
        for (const draft of drafts) {
          if ('content' in draft) next[draft.entryId] = { choice: 'merged', content: draft.content }
          else nextErrors[draft.entryId] = draft.error
        }
        return next
      })
      setErrors(nextErrors)
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '합치지 못했어.', en: 'Could not draft.' })), tone: 'error' }),
  })
  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (onSubmit) {
        await onSubmit(decisions())
        return null
      }
      return mergeLorebook(targetId as number, { sourceId, decisions: decisions(), ...(deleteSource ? { deleteSource } : {}), ...(entryIds ? { entryIds } : {}) })
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: OWN_LOREBOOKS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })
      onMerged(result)
    },
    onError: (error) => {
      // The books changed meanwhile: show the new preview and ask again.
      if (error instanceof LoreDecisionsNeededError) setOverride(error.preview)
      showSnackbar({ message: getErrorMessage(error, t({ ko: '병합하지 못했어.', en: 'Could not merge.' })), tone: 'error' })
    },
  })

  const selected = duplicates.find((item) => item.entry.id === selectedId) ?? null
  const selectedChoice = selected ? choices[selected.entry.id] : undefined
  const sourceLabel = preview?.source.kind === 'chat' ? t({ ko: '채팅 책', en: 'Chat book' }) : preview?.source.name ?? ''
  const targetLabel = preview?.target.name ?? ''
  const draftProfile = profiles.find((profile) => profile.id === profileId) ?? null
  const setChoice = (entryId: string, patch: Partial<Choice>) => setChoices((current) => ({ ...current, [entryId]: { ...(current[entryId] ?? { choice: 'merged', content: '' }), ...patch } }))

  return (
    <>
      <ModalBody>
        {fixedTargetId == null && !initialPreview ? (
          <SettingRow label={t({ ko: '대상', en: 'Into' })}>
            <Select className="w-56" value={targetId === null ? '' : String(targetId)} onChange={(event) => { setOverride(null); setTargetId(event.target.value ? Number(event.target.value) : null) }} aria-label={t({ ko: '병합할 계정 로어북', en: 'Account lorebook to merge into' })}>
              <option value="">{t({ ko: '고르기', en: 'Choose' })}</option>
              {targets.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
            </Select>
          </SettingRow>
        ) : null}
        {targetId !== null && !preview && previewQuery.isPending ? <div className="flex justify-center py-6"><Spinner /></div> : null}
        {previewQuery.isError && !preview ? <p className="text-sm text-destructive">{getErrorMessage(previewQuery.error, t({ ko: '불러오지 못했어.', en: 'Could not load.' }))}</p> : null}
        {preview ? (
          <>
            <div className="flex flex-col">
              {preview.items.map((item) => {
                const title = loreEntryTitle(item.entry) || item.entry.id
                if (item.status === 'new') {
                  return (
                    <div key={item.entry.id} className="flex min-h-8 items-center gap-2 border-t border-line px-1.5 text-sm first:border-t-0">
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                      <span className="shrink-0 text-xs font-semibold text-success">{t({ ko: '새 항목', en: 'New' })}</span>
                    </div>
                  )
                }
                const other = item.duplicateOf ? loreEntryTitle(item.duplicateOf) : ''
                return (
                  // eslint-disable-next-line no-restricted-syntax -- a selectable list row beside plain ones; Button would pad and centre it
                  <button
                    key={item.entry.id}
                    type="button"
                    onClick={() => setSelectedId(item.entry.id)}
                    aria-pressed={selectedId === item.entry.id}
                    className={cn('flex min-h-8 items-center gap-2 border-t border-line px-1.5 text-left text-sm first:border-t-0 hover:bg-fill', selectedId === item.entry.id && 'bg-fill')}
                  >
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                    {errors[item.entry.id] ? <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden /> : null}
                    <span className="shrink-0 text-xs font-semibold text-destructive">{t({ ko: '중복 · {name}의 "{title}"', en: 'Duplicate · "{title}" in {name}' }, { name: targetLabel, title: other })}</span>
                  </button>
                )
              })}
              {preview.items.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{t({ ko: '옮길 항목이 없어.', en: 'Nothing to merge.' })}</p> : null}
            </div>
            {selected && selectedChoice ? (
              <div className="space-y-3">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <ComparePane label={`${sourceLabel} · ${loreEntryTitle(selected.entry)}`} text={selected.entry.content} />
                  <ComparePane
                    label={`${targetLabel} · ${selected.duplicateOf ? loreEntryTitle(selected.duplicateOf) : ''}`}
                    extra={selected.duplicateOf?.file ? t({ ko: '자료 1', en: '1 file' }) : undefined}
                    text={selected.duplicateOf?.content ?? ''}
                  />
                </div>
                <Field label={t({ ko: '합친 결과', en: 'Merged text' })}>
                  <Textarea variant="settings" rows={4} value={selectedChoice.content} maxLength={20000} onChange={(event) => setChoice(selected.entry.id, { content: event.target.value, choice: 'merged' })} />
                </Field>
                {errors[selected.entry.id] ? <p className="text-xs text-warning">{errors[selected.entry.id]}</p> : null}
                <SegmentedControl
                  size="xs"
                  value={selectedChoice.choice}
                  onChange={(choice) => setChoice(selected.entry.id, { choice: choice as LoreMergeChoice })}
                  items={[
                    { value: 'source', label: preview.source.kind === 'chat' ? t({ ko: '채팅 책 것으로', en: 'Chat book’s' }) : t({ ko: '{name} 것으로', en: '{name}’s' }, { name: preview.source.name }) },
                    { value: 'target', label: t({ ko: '{name} 것 그대로', en: 'Keep {name}’s' }, { name: targetLabel }) },
                    { value: 'both', label: t({ ko: '둘 다 두기', en: 'Keep both' }) },
                    { value: 'merged', label: t({ ko: '합친 결과로', en: 'Merged text' }) },
                  ]}
                  ariaLabel={t({ ko: '중복 처리', en: 'Duplicate handling' })}
                />
              </div>
            ) : null}
            {instructionOpen && duplicates.length > 0 ? (
              <Input
                variant="settings"
                maxLength={2000}
                value={instruction ?? preview.defaultInstruction}
                onChange={(event) => setInstruction(event.target.value)}
                aria-label={t({ ko: '맡기기 지시', en: 'Instruction' })}
              />
            ) : null}
          </>
        ) : null}
      </ModalBody>
      <ModalFooter className="justify-start">
        {duplicates.length > 0 && profiles.length > 0 ? (
          <>
            <Button size="sm" variant="secondary" disabled={profileId === null || draftMutation.isPending || mergeMutation.isPending} onClick={() => draftMutation.mutate()}>
              {draftMutation.isPending ? <Spinner className="size-3.5" /> : <Sparkles />}
              {t({ ko: '{name}에게 맡기기', en: 'Ask {name}' }, { name: draftProfile?.name ?? '' })}
            </Button>
            <IconButton variant="ghost" size="icon-sm" active={instructionOpen} onClick={() => setInstructionOpen((open) => !open)} label={t({ ko: '지시 고치기', en: 'Edit instruction' })}><Pencil /></IconButton>
            {profiles.length > 1 ? (
              <Select className="h-8 w-40" value={profileId === null ? '' : String(profileId)} onChange={(event) => setProfileId(Number(event.target.value))} aria-label={t({ ko: '맡길 프로필', en: 'Profile to ask' })}>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </Select>
            ) : null}
          </>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button>
        <Button size="sm" disabled={!preview || changing === 0 || emptyMerged || mergeMutation.isPending} onClick={() => mergeMutation.mutate()}>
          {mergeMutation.isPending ? <Spinner className="size-3.5" /> : null}
          {t({ ko: '병합 ({count})', en: 'Merge ({count})' }, { count: changing })}
        </Button>
      </ModalFooter>
    </>
  )
}

function ComparePane({ label, extra, text }: { label: string; extra?: string; text: string }) {
  return (
    <div className="min-w-0 rounded-sm border border-line px-2.5 py-2 text-sm">
      <div className="mb-1 flex items-center justify-between gap-2 text-2xs font-semibold tracking-overline text-muted-foreground uppercase">
        <span className="min-w-0 truncate">{label}</span>
        {extra ? <span className="shrink-0">{extra}</span> : null}
      </div>
      <div className="leading-relaxed whitespace-pre-wrap text-foreground/85">{text}</div>
    </div>
  )
}
