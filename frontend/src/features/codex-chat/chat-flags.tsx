import { createElement, useEffect, useRef, useState, type CSSProperties, type DragEvent, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Eye, EyeOff, Flag, GripVertical, Pencil, Plus, RotateCcw, Save, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { ResourceRow } from '@/components/ui/resource-row'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import {
  CHAT_FLAG_LIMITS,
  CHAT_FLAGS_QUERY_KEY,
  createChatFlag,
  deleteChatFlag,
  listChatFlags,
  reorderChatFlags,
  resetChatFlag,
  restoreChatFlag,
  updateChatFlag,
  type ChatFlag,
  type ChatFlagSnapshot,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import type { ChatFlagStyle } from './chat-appearance'
import { CHAT_FLAG_EMOJI, CHAT_FLAG_ICON_GROUPS, LUCIDE_PREFIX, chatFlagLucideIcon } from './chat-flag-icons'

const POP_STAGGER_MS = 45
const DROP_STAGGER_MS = 18
const DROP_MS = 180

const visibleFlags = (flags: ChatFlag[]) => flags.filter((flag) => !flag.hidden)

/**
 * The account's chat flags: its own and the admins' shared ones, in tray order. `includeHidden` adds the shared flags
 * the account hid (where flags are managed); the tray leaves them out.
 */
export function useChatFlags(enabled = true, { includeHidden = false }: { includeHidden?: boolean } = {}) {
  return useQuery({ queryKey: CHAT_FLAGS_QUERY_KEY, queryFn: listChatFlags, enabled, staleTime: 60_000, select: includeHidden ? undefined : visibleFlags })
}

/** Whether the account may add another flag: admins fill the shared list, everyone else their own. */
export function useChatFlagRoom(flags: ChatFlag[]) {
  const isAdmin = useAuthStatusQuery().data?.isAdmin === true
  return flags.filter((flag) => flag.shared === isAdmin).length < CHAT_FLAG_LIMITS.perAccount
}

/** A flag's icon: a built-in icon, an emoji, or the name's first letter. */
export function ChatFlagIcon({ icon, name, className }: { icon: string; name: string; className?: string }) {
  const Lucide = chatFlagLucideIcon(icon)
  // A fixed icon from the catalog (module scope), picked by key: createElement keeps it from reading as a new component.
  if (Lucide) return createElement(Lucide, { 'aria-hidden': true, className: cn('size-4 shrink-0', className) })
  if (icon && !icon.startsWith(LUCIDE_PREFIX)) return <span aria-hidden="true" className={cn('shrink-0 text-base leading-none', className)}>{icon}</span>
  return <span aria-hidden="true" className={cn('shrink-0 text-xs font-bold leading-none', className)}>{[...name.trim()][0]?.toUpperCase() ?? '?'}</span>
}

/** The composer's flag button (next to attach): how many flags are on, and opens the tray. */
export function ChatFlagButton({ buttonRef, count, open, disabled, onToggle }: {
  buttonRef: RefObject<HTMLButtonElement | null>
  count: number
  open: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  return (
    <IconButton
      ref={buttonRef}
      variant="ghost"
      size="icon-sm"
      className={cn('relative rounded-full', count > 0 && 'text-primary hover:text-primary', open && 'bg-primary/15 text-primary')}
      aria-expanded={open}
      disabled={disabled}
      onClick={onToggle}
      label={t({ ko: '플래그', en: 'Flags' })}
    >
      <Flag className={cn('transition-transform duration-300 ease-[cubic-bezier(.2,.9,.3,1.3)]', open && '-rotate-12 scale-110')} />
      {count > 0 ? (
        <span key={count} className="absolute -right-0.5 -top-0.5 min-w-3.5 animate-chat-flag-badge rounded-full bg-primary px-1 text-center text-2xs font-bold leading-3.5 text-primary-foreground tabular-nums motion-reduce:animate-none">
          {count}
        </span>
      ) : null}
    </IconButton>
  )
}

type TrayPhase = 'open' | 'closing' | 'closed'

/**
 * The flags, popped up above the composer in one row: each springs up a beat after the one before it, and a tap
 * switches it on or off for this chat. Closes on Esc or a click elsewhere (not on the flag button, which toggles).
 */
export function ChatFlagTray({ flags, activeIds, open, flagStyle, buttonRef, onToggle, onManage, onClose }: {
  flags: ChatFlag[]
  activeIds: number[]
  open: boolean
  flagStyle: ChatFlagStyle
  buttonRef: RefObject<HTMLButtonElement | null>
  onToggle: (flagId: number) => void
  onManage: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const trayRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<TrayPhase>(open ? 'open' : 'closed')
  const [taps, setTaps] = useState<Record<number, number>>({})
  const count = flags.length + 1

  useEffect(() => {
    if (open) {
      setPhase('open')
      return
    }
    setPhase((current) => (current === 'open' ? 'closing' : current))
    const timer = window.setTimeout(() => setPhase('closed'), DROP_MS + count * DROP_STAGGER_MS + 40)
    return () => window.clearTimeout(timer)
  }, [open, count])

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (trayRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      // Tooltips and the manage dialog live in portals; a click there must not count as outside.
      if ((target as Element).closest?.('[data-radix-popper-content-wrapper], [role="dialog"]')) return
      onClose()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [buttonRef, onClose, open])

  if (phase === 'closed') return null
  const closing = phase === 'closing'
  const motion = (index: number): { className: string; style: CSSProperties } => closing
    ? { className: 'animate-chat-flag-drop motion-reduce:animate-none motion-reduce:opacity-0', style: { animationDelay: `${(count - 1 - index) * DROP_STAGGER_MS}ms` } }
    : { className: 'animate-chat-flag-pop motion-reduce:animate-chat-flag-fade', style: { animationDelay: `${index * POP_STAGGER_MS}ms` } }
  const round = flagStyle === 'icon'

  return (
    <div ref={trayRef} role="group" aria-label={t({ ko: '플래그', en: 'Flags' })} className={cn('absolute inset-x-0 bottom-full z-10 flex items-center gap-1.5 overflow-x-auto px-3 pb-1.5 pt-2 [scrollbar-width:none]', closing && 'pointer-events-none')}>
      {flags.map((flag, index) => {
        const pressed = activeIds.includes(flag.id)
        const { className, style } = motion(index)
        const chip = (
          // eslint-disable-next-line no-restricted-syntax -- a toggle chip that springs in; Button's fills and sizes do not fit
          <button
            key={flag.id}
            type="button"
            aria-pressed={pressed}
            aria-label={flag.name}
            style={style}
            onClick={() => { onToggle(flag.id); setTaps((current) => ({ ...current, [flag.id]: (current[flag.id] ?? 0) + 1 })) }}
            className={cn(
              'flex shrink-0 cursor-pointer items-center justify-center border bg-surface-container text-foreground shadow-elevation-1 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40',
              round ? 'size-10 rounded-full' : 'h-9 rounded-full pl-2.5 pr-3.5',
              pressed ? 'border-primary bg-primary/15 text-secondary-text' : 'border-line hover:bg-surface-high',
              className,
            )}
          >
            <span key={taps[flag.id] ?? 0} className={cn('flex items-center gap-1.5', taps[flag.id] && 'animate-chat-flag-tap motion-reduce:animate-none')}>
              <ChatFlagIcon icon={flag.icon} name={flag.name} className={round ? 'size-[18px] text-[1.1rem]' : undefined} />
              {round ? null : <span className="whitespace-nowrap text-sm font-semibold">{flag.name}</span>}
            </span>
          </button>
        )
        return round ? <Tip key={flag.id} content={flag.name} side="top">{chip}</Tip> : chip
      })}
      {(() => {
        const { className, style } = motion(flags.length)
        return (
          <Tip content={t({ ko: '플래그 관리', en: 'Manage flags' })} side="top">
            {/* eslint-disable-next-line no-restricted-syntax -- matches the flag chips beside it */}
            <button
              type="button"
              style={style}
              onClick={onManage}
              aria-label={t({ ko: '플래그 관리', en: 'Manage flags' })}
              className={cn('flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-foreground/25 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40', round ? 'size-10' : 'size-9', className)}
            >
              <Pencil className="size-4" />
            </button>
          </Tip>
        )
      })()}
    </div>
  )
}

/** Under a sent message: the flags that were on for it (hover shows what was added). */
export function ChatMessageFlags({ flags }: { flags?: ChatFlagSnapshot[] }) {
  if (!flags?.length) return null
  return (
    <div className="mt-1 flex flex-wrap justify-end gap-1">
      {flags.map((flag, index) => (
        <Tip key={`${flag.id}-${index}`} content={<span className="whitespace-pre-wrap">{flag.content}</span>}>
          <span tabIndex={0} className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 text-2xs leading-[18px] text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
            <ChatFlagIcon icon={flag.icon} name={flag.name} className="size-3 text-xs" />
            {flag.name}
          </span>
        </Tip>
      ))}
    </div>
  )
}

type PickerTab = 'icon' | 'emoji'

/** Choose a flag's icon: built-in icons by group, or an emoji (picked or typed). */
function ChatFlagIconPicker({ value, name, onChange }: { value: string; name: string; onChange: (icon: string) => void }) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<PickerTab>(value && !value.startsWith(LUCIDE_PREFIX) ? 'emoji' : 'icon')
  const [typed, setTyped] = useState('')
  const pick = (icon: string) => { onChange(icon); setOpen(false) }
  const tile = (selected: boolean) => cn('flex size-9 cursor-pointer items-center justify-center rounded-md outline-none transition-colors hover:bg-surface-high focus-visible:ring-[3px] focus-visible:ring-ring/40', selected && 'bg-primary/15 text-secondary-text ring-1 ring-primary')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* eslint-disable-next-line no-restricted-syntax -- the icon itself is the control, sized like the input beside it */}
        <button type="button" aria-label={t({ ko: '아이콘 고르기', en: 'Choose icon' })} className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line bg-surface-low text-foreground outline-none transition-colors hover:bg-surface-high focus-visible:ring-[3px] focus-visible:ring-ring/40">
          <ChatFlagIcon icon={value} name={name || '?'} className="size-5 text-xl" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <div role="tablist" className="flex gap-4 border-b border-line px-3 pt-2">
          {(['icon', 'emoji'] as const).map((key) => (
            // eslint-disable-next-line no-restricted-syntax -- text tabs inside the picker frame
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={cn('-mb-px cursor-pointer border-b-2 pb-1.5 text-sm font-semibold outline-none transition-colors focus-visible:text-foreground', tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {key === 'icon' ? t({ ko: '아이콘', en: 'Icons' }) : t({ ko: '이모지', en: 'Emoji' })}
            </button>
          ))}
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto p-3">
          <div className="grid grid-cols-8 gap-0.5">
            <Tip content={t({ ko: '이름 첫 글자', en: 'First letter of the name' })}>
              {/* eslint-disable-next-line no-restricted-syntax -- picker tile */}
              <button type="button" aria-label={t({ ko: '이름 첫 글자', en: 'First letter of the name' })} className={cn(tile(!value), 'text-muted-foreground')} onClick={() => pick('')}><Ban className="size-4" /></button>
            </Tip>
          </div>
          {tab === 'icon' ? CHAT_FLAG_ICON_GROUPS.map((group) => (
            <div key={group.label.en} className="space-y-1">
              <div className="text-2xs font-semibold text-muted-foreground">{locale.startsWith('en') ? group.label.en : group.label.ko}</div>
              <div className="grid grid-cols-8 gap-0.5">
                {Object.entries(group.icons).map(([key, Icon]) => {
                  const icon = `${LUCIDE_PREFIX}${key}`
                  return (
                    <Tip key={key} content={key}>
                      {/* eslint-disable-next-line no-restricted-syntax -- picker tile */}
                      <button type="button" aria-label={key} className={tile(value === icon)} onClick={() => pick(icon)}>
                        <Icon className="size-[18px]" />
                      </button>
                    </Tip>
                  )
                })}
              </div>
            </div>
          )) : (
            <>
              <div className="grid grid-cols-8 gap-0.5">
                {CHAT_FLAG_EMOJI.map((emoji) => (
                  // eslint-disable-next-line no-restricted-syntax -- picker tile
                  <button key={emoji} type="button" aria-label={emoji} className={cn(tile(value === emoji), 'text-xl')} onClick={() => pick(emoji)}>{emoji}</button>
                ))}
              </div>
              <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); const emoji = typed.trim(); if (emoji) pick(emoji) }}>
                <Input variant="settings" value={typed} maxLength={16} onChange={(event) => setTyped(event.target.value)} placeholder={t({ ko: '다른 이모지 입력', en: 'Type another emoji' })} aria-label={t({ ko: '이모지 입력', en: 'Emoji' })} />
                <Button type="submit" size="sm" variant="secondary" disabled={!typed.trim()}>{t({ ko: '적용', en: 'Use' })}</Button>
              </form>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Create or edit one flag: its icon, name, and the text added to the messages sent while it is on. */
export function ChatFlagEditorModal({ open, flag, onClose }: { open: boolean; flag: ChatFlag | null; onClose: () => void }) {
  const { t } = useI18n()
  const isAdmin = useAuthStatusQuery().data?.isAdmin === true
  // A shared flag is the admin's: anyone else edits their own copy and only hides it.
  const ownCopy = flag?.shared === true && !isAdmin
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState({ icon: '', name: '', content: '' })

  useEffect(() => {
    if (open) setDraft({ icon: flag?.icon ?? '', name: flag?.name ?? '', content: flag?.content ?? '' })
  }, [flag, open])

  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const saveMutation = useMutation({
    mutationFn: () => (flag ? updateChatFlag(flag.id, draft) : createChatFlag(draft)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: CHAT_FLAGS_QUERY_KEY }); onClose() },
    onError,
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatFlag(flag?.id ?? 0),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: CHAT_FLAGS_QUERY_KEY }); onClose() },
    onError,
  })
  const resetMutation = useMutation({
    mutationFn: () => resetChatFlag(flag?.id ?? 0),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: CHAT_FLAGS_QUERY_KEY }); onClose() },
    onError,
  })
  const handleDelete = async () => {
    // Hiding a shared flag is undone from the flag list, so it needs no confirmation.
    if (ownCopy) {
      deleteMutation.mutate()
      return
    }
    const confirmed = await confirm({
      title: t({ ko: '플래그 삭제', en: 'Delete flag' }),
      description: flag?.shared
        ? t({ ko: '모두에게 공유된 플래그야. 지우면 모든 계정에서 사라져. 이미 보낸 메시지에 붙은 기록은 남아.', en: 'This flag is shared with everyone; deleting it removes it for every account. Messages already sent keep it.' })
        : t({ ko: '이 플래그를 지울까? 이미 보낸 메시지에 붙은 기록은 남아.', en: 'Delete this flag? Messages already sent keep it.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }
  const canSave = draft.name.trim().length > 0 && draft.content.trim().length > 0 && !saveMutation.isPending

  return (
    <Modal open={open} onClose={onClose} title={flag ? t({ ko: '플래그 편집', en: 'Edit flag' }) : t({ ko: '플래그 추가', en: 'Add flag' })} widthClassName="max-w-lg">
      <ModalBody className="space-y-4">
        <div className="flex items-end gap-3">
          <ChatFlagIconPicker value={draft.icon} name={draft.name} onChange={(icon) => setDraft((current) => ({ ...current, icon }))} />
          <Field label={t({ ko: '이름', en: 'Name' })} className="min-w-0 flex-1">
            <Input variant="settings" value={draft.name} maxLength={CHAT_FLAG_LIMITS.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </Field>
        </div>
        <Field label={t({ ko: '넣을 내용', en: 'Instruction' })}>
          <Textarea
            variant="settings"
            rows={5}
            maxLength={CHAT_FLAG_LIMITS.content}
            value={draft.content}
            placeholder={t({ ko: '답할 때 지금 장면을 NovelAI로 이미지 생성해서 같이 보여줘.', en: 'Also generate the current scene with NovelAI when you answer.' })}
            onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
          />
        </Field>
      </ModalBody>
      <ModalFooter>
        {flag && ownCopy ? (
          <IconButton size="icon-sm" variant="ghost" disabled={deleteMutation.isPending || flag.hidden} onClick={() => void handleDelete()} label={t({ ko: '나한테서 숨기기', en: 'Hide for me' })}><EyeOff /></IconButton>
        ) : flag ? <IconButton size="icon-sm" variant="destructive" disabled={deleteMutation.isPending} onClick={() => void handleDelete()} label={t({ ko: '삭제', en: 'Delete' })}><Trash2 /></IconButton> : null}
        {flag && ownCopy && flag.edited ? (
          <IconButton size="icon-sm" variant="ghost" disabled={resetMutation.isPending} onClick={() => resetMutation.mutate()} label={t({ ko: '관리자 원본으로 되돌리기', en: 'Back to the original' })}><RotateCcw /></IconButton>
        ) : null}
        <span className="flex-1" />
        <IconButton size="icon-sm" variant="default" disabled={!canSave} onClick={() => saveMutation.mutate()} label={t({ ko: '저장', en: 'Save' })}><Save /></IconButton>
      </ModalFooter>
    </Modal>
  )
}

/**
 * The account's flags as rows (drag the handle to reorder; the order is the tray's). Shared flags it hid follow,
 * dimmed, each with a button to bring it back.
 */
export function ChatFlagRows({ flags: allFlags, onEdit }: { flags: ChatFlag[]; onEdit: (flag: ChatFlag) => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const isAdmin = useAuthStatusQuery().data?.isAdmin === true
  const flags = visibleFlags(allFlags)
  const hiddenFlags = allFlags.filter((flag) => flag.hidden)
  const restoreMutation = useMutation({
    mutationFn: restoreChatFlag,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAT_FLAGS_QUERY_KEY }),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '다시 보이게 하지 못했어.', en: 'Could not show it again.' })), tone: 'error' }),
  })
  const sharedMark = (flag: ChatFlag) => flag.shared ? (
    <Tip content={isAdmin
      ? t({ ko: '모든 계정에 공유돼', en: 'Shared with every account' })
      : flag.edited ? t({ ko: '공유 플래그 (내가 고침)', en: 'Shared flag (my edit)' }) : t({ ko: '관리자 공유 플래그', en: 'Shared by an admin' })}>
      <Users aria-hidden="true" className={cn('size-3.5 shrink-0', flag.edited ? 'text-primary' : 'text-muted-foreground')} />
    </Tip>
  ) : null
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const reorderMutation = useMutation({
    mutationFn: reorderChatFlags,
    onMutate: (ids) => {
      queryClient.setQueryData<ChatFlag[]>(CHAT_FLAGS_QUERY_KEY, (current) => current ? [...ids.flatMap((id) => current.filter((flag) => flag.id === id)), ...current.filter((flag) => !ids.includes(flag.id))] : current)
    },
    onSuccess: (next) => queryClient.setQueryData(CHAT_FLAGS_QUERY_KEY, next),
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: CHAT_FLAGS_QUERY_KEY })
      showSnackbar({ message: getErrorMessage(error, t({ ko: '순서를 바꾸지 못했어.', en: 'Could not reorder.' })), tone: 'error' })
    },
  })
  const drop = (event: DragEvent, targetId: number) => {
    event.preventDefault()
    if (dragId === null || dragId === targetId) return
    const ids = flags.map((flag) => flag.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId) + (flags.findIndex((flag) => flag.id === dragId) < flags.findIndex((flag) => flag.id === targetId) ? 1 : 0), 0, dragId)
    reorderMutation.mutate(ids)
  }

  return (
    <>
      {flags.map((flag) => (
        <ResourceRow
          key={flag.id}
          onDragOver={(event) => { if (dragId !== null) { event.preventDefault(); setOverId(flag.id) } }}
          onDragLeave={() => setOverId((current) => (current === flag.id ? null : current))}
          onDrop={(event) => { drop(event, flag.id); setDragId(null); setOverId(null) }}
          className={cn(dragId === flag.id && 'opacity-50', overId === flag.id && dragId !== flag.id && 'bg-primary/8 hover:bg-primary/8')}
          leading={(
            <>
              <Tip content={t({ ko: '끌어서 순서 바꾸기', en: 'Drag to reorder' })}>
                <span
                  draggable
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => { setDragId(flag.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(flag.id)) }}
                  onDragEnd={() => { setDragId(null); setOverId(null) }}
                  className="mr-3 cursor-grab text-muted-foreground/60 active:cursor-grabbing"
                  aria-hidden="true"
                >
                  <GripVertical className="size-4" />
                </span>
              </Tip>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-high text-foreground">
                <ChatFlagIcon icon={flag.icon} name={flag.name} />
              </span>
            </>
          )}
          name={flag.name}
          extra={sharedMark(flag)}
          onOpen={() => onEdit(flag)}
        />
      ))}
      {hiddenFlags.map((flag) => (
        <ResourceRow
          key={flag.id}
          className="opacity-55"
          leading={(
            <span className="ml-7 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-high text-foreground">
              <ChatFlagIcon icon={flag.icon} name={flag.name} />
            </span>
          )}
          name={flag.name}
          extra={sharedMark(flag)}
          trailing={<IconButton size="icon-sm" variant="ghost" disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate(flag.id)} label={t({ ko: '다시 보이기', en: 'Show again' })}><Eye /></IconButton>}
        />
      ))}
    </>
  )
}

/** From the chat: the account's flags, to add, edit and reorder without leaving the conversation. */
export function ChatFlagManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const flagsQuery = useChatFlags(open, { includeHidden: true })
  const [editor, setEditor] = useState<{ flag: ChatFlag | null } | null>(null)
  const flags = flagsQuery.data ?? []
  const full = !useChatFlagRoom(flags)

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t({ ko: '플래그 관리', en: 'Manage flags' })}
        widthClassName="max-w-xl"
        headerContent={<IconButton size="icon-sm" variant="ghost" disabled={full} onClick={() => setEditor({ flag: null })} label={t({ ko: '플래그 추가', en: 'Add flag' })}><Plus /></IconButton>}
      >
        <ModalBody>
          {flagsQuery.isSuccess && flags.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-4 text-xs text-muted-foreground">
              {t({ ko: '아직 플래그가 없어.', en: 'No flags yet.' })}
              <IconButton size="icon-sm" variant="secondary" label={t({ ko: '플래그 추가', en: 'Add flag' })} onClick={() => setEditor({ flag: null })}><Plus /></IconButton>
            </div>
          ) : (
            <ChatFlagRows flags={flags} onEdit={(flag) => setEditor({ flag })} />
          )}
        </ModalBody>
      </Modal>
      <ChatFlagEditorModal open={editor !== null} flag={editor?.flag ?? null} onClose={() => setEditor(null)} />
    </>
  )
}
