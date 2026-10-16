import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Dices, Link2, Lock, Plus, RefreshCw, Server, SlidersHorizontal, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import {
  AUDIO_QUERY_KEY,
  addDefaultAudioWorkflow,
  checkAudioWorkflow,
  createAudioOrder,
  listAudioWorkflows,
  saveAudioWorkflowBinding,
  updateAudioGroup,
  type AudioGroup,
  type AudioOrder,
  type AudioWorkflowSummary,
} from '@/lib/api-audio'
import { getGenerationComfyUIServers } from '@/lib/api-image-generation-workflows'
import { getErrorMessage } from '@/lib/error-message'
import { createRandomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'
import { CompatLine } from './audio-settings-dialog'

const GLOBAL_PREFS_KEY = 'conai:audio:generate'
const GENERATION_PREFS_KEY = 'conai:audio:generate:parameters'
const legacyGroupPrefsKey = (groupId: string) => `conai:audio:generate:${groupId}`

interface GenerationPrefs { seconds: string; count: string; seed: string }
interface GlobalPrefs { workflowId: number | null; route: string }

function readPrefs<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback
  } catch {
    return fallback
  }
}

function writePrefs(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked: the values still hold for this visit.
  }
}

/** The binding the server would have suggested, when all three roles have distinct fields. */
function suggestedBinding(workflow: AudioWorkflowSummary) {
  const { prompt, seconds, seed } = workflow.suggested
  if (!prompt || !seconds || !seed || new Set([prompt, seconds, seed]).size !== 3) return null
  return { prompt_field_id: prompt, seconds_field_id: seconds, seed_field_id: seed }
}

type Readiness =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'no-permission' }
  | { kind: 'no-workflow' }
  | { kind: 'no-server' }
  | { kind: 'unlinked'; candidate: AudioWorkflowSummary }
  | { kind: 'servers'; blocked: boolean }
  | { kind: 'ready' }

/**
 * Inline generation for one effect: its representative prompt (saved back to the effect on generate), length, count and seed, and a
 * status chip that says which workflow and servers will run it. When something blocks generation the chip turns
 * red or amber and the fix sits next to it; the generate button stays in place, disabled.
 */
export function AudioGenerateBar({ group, autoFocus = false, canGenerate, canAddWorkflow, onOrdered, onPromptSaved, onOpenSettings }: {
  group: AudioGroup
  /** Focus the prompt (a just-created effect). */
  autoFocus?: boolean
  canGenerate: boolean
  /** audio.edit + workflows.edit: may register the default Stable Audio 3 workflow. */
  canAddWorkflow: boolean
  onOrdered: (order: AudioOrder) => void
  onPromptSaved: () => void
  /** Open 오디오 설정 › 워크플로 on this workflow. */
  onOpenSettings: (workflowId: number | null) => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const workflows = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'workflows'], queryFn: listAudioWorkflows, enabled: canGenerate })
  const servers = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'servers'], queryFn: () => getGenerationComfyUIServers(true), enabled: canGenerate, retry: false })
  const [text, setText] = useState(group.prompt)
  // Keep the last generation settings across effects; migrate the current effect's saved values on first use.
  const [prefs, setPrefs] = useState<GenerationPrefs>(() => readPrefs(GENERATION_PREFS_KEY, readPrefs(legacyGroupPrefsKey(group.id), { seconds: '3', count: '4', seed: '' })))
  const [global, setGlobal] = useState<GlobalPrefs>(() => readPrefs(GLOBAL_PREFS_KEY, { workflowId: null, route: '' }))
  const [busy, setBusy] = useState<'order' | 'fix' | 'check' | null>(null)
  const [chipOpen, setChipOpen] = useState(false)
  const fail = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })

  // The prompt follows the effect's representative prompt while it is untouched here (a dialog edit shows up at once).
  const syncedPrompt = useRef(group.prompt)
  useEffect(() => {
    setText((current) => (current === syncedPrompt.current ? group.prompt : current))
    syncedPrompt.current = group.prompt
  }, [group.prompt])
  useEffect(() => { writePrefs(GENERATION_PREFS_KEY, prefs) }, [prefs])
  useEffect(() => { writePrefs(GLOBAL_PREFS_KEY, global) }, [global])

  const list = useMemo(() => workflows.data ?? [], [workflows.data])
  const bound = useMemo(() => list.filter((entry) => entry.binding && entry.is_active), [list])
  const workflow = bound.find((entry) => entry.id === global.workflowId) ?? bound.find((entry) => entry.binding?.is_default) ?? bound[0] ?? null
  const compat = workflow?.binding?.compat ?? null
  const routeServerId = global.route.startsWith('server:') ? Number(global.route.slice(7)) : null
  const scoped = compat ? (routeServerId !== null ? compat.servers.filter((entry) => entry.server_id === routeServerId) : compat.servers) : []
  const okServers = scoped.filter((entry) => entry.status === 'ok').length
  const secondsMax = compat?.seconds_max ?? null
  const tags = [...new Set((servers.data ?? []).flatMap((server) => server.routing_tags ?? []))]

  const readiness: Readiness = !canGenerate ? { kind: 'no-permission' }
    : workflows.isPending ? { kind: 'loading' }
    : workflows.isError ? { kind: 'error' }
    : list.length === 0 ? { kind: 'no-workflow' }
    : !workflow ? { kind: 'unlinked', candidate: list.find((entry) => entry.is_active) ?? list[0] }
    : servers.isSuccess && servers.data.length === 0 ? { kind: 'no-server' }
    // The server refuses an order only when every server it may use is incompatible; unreachable ones only warn.
    : scoped.length > 0 && okServers === 0 ? { kind: 'servers', blocked: scoped.every((entry) => entry.status === 'incompatible') }
    : { kind: 'ready' }

  const seconds = Number(prefs.seconds)
  const count = Number(prefs.count)
  const secondsOver = secondsMax !== null && seconds > secondsMax
  const valid = text.trim().length > 0 && seconds > 0 && !secondsOver && Number.isInteger(count) && count >= 1 && count <= 50 && (prefs.seed.trim() === '' || /^\d+$/.test(prefs.seed.trim()))
  const runnable = workflow !== null && (readiness.kind === 'ready' || (readiness.kind === 'servers' && !readiness.blocked))

  const refreshWorkflows = () => queryClient.fetchQuery({ queryKey: [AUDIO_QUERY_KEY, 'workflows'], queryFn: listAudioWorkflows, staleTime: 0 })
  const link = async (target: AudioWorkflowSummary) => {
    const binding = suggestedBinding(target)
    if (!binding) {
      onOpenSettings(target.id)
      return
    }
    await saveAudioWorkflowBinding(target.id, { ...binding, is_default: !list.some((entry) => entry.binding) })
    await refreshWorkflows()
    setGlobal((current) => ({ ...current, workflowId: target.id }))
    showSnackbar({ message: t({ ko: '{name} 연결했어.', en: 'Linked {name}.' }, { name: target.name }) })
  }
  const runFix = async (work: () => Promise<void>) => {
    setBusy('fix')
    try {
      await work()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(null)
    }
  }
  const addDefault = () => runFix(async () => {
    const created = await addDefaultAudioWorkflow() as { id?: number; workflow?: { id?: number } } | null
    const fresh = await refreshWorkflows()
    const id = created?.workflow?.id ?? created?.id
    const target = fresh.find((entry) => entry.id === id) ?? fresh[0]
    if (target) await link(target)
  })
  const recheck = async () => {
    if (!workflow) return
    setBusy('check')
    try {
      await checkAudioWorkflow(workflow.id)
      await refreshWorkflows()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(null)
    }
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!runnable || !valid || !workflow || busy) return
    setBusy('order')
    try {
      const prompt = text.trim()
      if (prompt !== group.prompt.trim()) {
        await updateAudioGroup(group.id, { prompt })
        syncedPrompt.current = prompt
        onPromptSaved()
      }
      onOrdered(await createAudioOrder({
        group_id: group.id,
        workflow_id: workflow.id,
        text: prompt,
        seconds,
        count,
        seed: prefs.seed.trim() === '' ? null : Number(prefs.seed.trim()),
        request_key: createRandomUuid(),
        server_id: routeServerId,
        server_tag: global.route.startsWith('tag:') ? global.route.slice(4) : null,
      }))
    } catch (error) {
      fail(error)
    } finally {
      setBusy(null)
    }
  }

  const savePrompt = async () => {
    const prompt = text.trim()
    if (!prompt || prompt === group.prompt.trim() || busy === 'order') return
    try {
      await updateAudioGroup(group.id, { prompt })
      syncedPrompt.current = prompt
      onPromptSaved()
    } catch (error) {
      fail(error)
    }
  }

  const set = (patch: Partial<GenerationPrefs>) => setPrefs((current) => ({ ...current, ...patch }))
  const workflowDetail = workflow ? [
    workflow.name,
    secondsMax !== null ? t({ ko: '최대 {max}초', en: 'max {max} s' }, { max: secondsMax }) : null,
    scoped.length > 0 ? t({ ko: '서버 {ok}/{total} 사용 가능', en: '{ok}/{total} servers usable' }, { ok: okServers, total: scoped.length }) : null,
  ].filter(Boolean).join(' · ') : ''

  let chip: ReactNode
  let fix: ReactNode = null
  if (readiness.kind === 'no-permission') {
    chip = <StatusChip icon={<Lock className="size-3.5" />}>{t({ ko: '생성 권한 없음', en: 'No permission to generate' })}</StatusChip>
  } else if (readiness.kind === 'loading') {
    chip = <StatusChip tone="idle">…</StatusChip>
  } else if (readiness.kind === 'error') {
    chip = <StatusChip tone="bad">{t({ ko: '워크플로 목록을 못 불러왔어', en: 'Could not load workflows' })}</StatusChip>
  } else if (readiness.kind === 'no-workflow') {
    chip = <StatusChip tone="bad">{t({ ko: '오디오 워크플로 없음', en: 'No audio workflow' })}</StatusChip>
    if (canAddWorkflow) fix = <IconButton variant="secondary" size="icon-sm" disabled={busy !== null} onClick={() => void addDefault()} label={t({ ko: 'Stable Audio 3 추가', en: 'Add Stable Audio 3' })}><Plus /></IconButton>
  } else if (readiness.kind === 'no-server') {
    chip = <StatusChip tone="bad">{t({ ko: 'ComfyUI 서버 없음', en: 'No ComfyUI server' })}</StatusChip>
    fix = <IconButton variant="secondary" size="icon-sm" onClick={() => navigate('/generation?tab=comfyui')} label={t({ ko: '서버 추가', en: 'Add a server' })}><Server /></IconButton>
  } else if (readiness.kind === 'unlinked') {
    const { candidate } = readiness
    chip = <StatusChip tone="warn">{t({ ko: '{name} · 연결 안 됨', en: '{name} · not linked' }, { name: candidate.name })}</StatusChip>
    fix = <IconButton variant="secondary" size="icon-sm" disabled={busy !== null} onClick={() => void runFix(() => link(candidate))} label={t({ ko: '연결', en: 'Link' })}><Link2 /></IconButton>
  } else {
    chip = (
      <Popover open={chipOpen} onOpenChange={setChipOpen}>
        <Tip content={t({ ko: '{detail}\n눌러서 워크플로·서버 고르기', en: '{detail}\nClick to pick the workflow and server' }, { detail: workflowDetail })} className="whitespace-pre-line">
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="max-w-full min-w-0 gap-1.5 font-normal text-foreground">
              <span className={cn('size-1.5 shrink-0 rounded-full', readiness.kind === 'ready' ? 'bg-success' : readiness.blocked ? 'bg-destructive' : 'bg-warning')} aria-hidden />
              <span className="min-w-0 truncate">{workflow?.name}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </Button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent align="end" className="w-80 space-y-3">
          {bound.length > 1 ? (
            <Field label={t({ ko: '워크플로', en: 'Workflow' })}>
              <Select value={workflow?.id ?? ''} onChange={(event) => setGlobal((current) => ({ ...current, workflowId: Number(event.target.value) }))}>
                {bound.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label={t({ ko: '서버', en: 'Server' })}>
            <Select value={global.route} onChange={(event) => setGlobal((current) => ({ ...current, route: event.target.value }))}>
              <option value="">{t({ ko: '자동', en: 'Auto' })}</option>
              {tags.map((tag) => <option key={`tag:${tag}`} value={`tag:${tag}`}>{t({ ko: '자동 · {tag}', en: 'Auto · {tag}' }, { tag })}</option>)}
              {(servers.data ?? []).filter((server) => server.backend_type !== 'modal').map((server) => <option key={server.id} value={`server:${server.id}`}>{server.name}</option>)}
            </Select>
          </Field>
          <CompatLine compat={compat} />
          <div className="flex items-center justify-end gap-1">
            <IconButton variant="ghost" size="icon-xs" disabled={busy !== null} onClick={() => void recheck()} label={t({ ko: '다시 검사: 서버와 워크플로 호환성을 다시 확인해', en: 'Check again: re-test servers against this workflow' })}><RefreshCw /></IconButton>
            <IconButton variant="ghost" size="icon-xs" onClick={() => { setChipOpen(false); onOpenSettings(workflow?.id ?? null) }} label={t({ ko: '오디오 설정', en: 'Audio settings' })}><SlidersHorizontal /></IconButton>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  const seedText = prefs.seed.trim()
  const lengthTip = secondsMax !== null
    ? t({ ko: '길이(초): 만들 오디오 길이, 최대 {max}초', en: 'Length (s): clip length, up to {max} s' }, { max: secondsMax })
    : t({ ko: '길이(초): 만들 오디오 길이', en: 'Length (s): clip length' })

  // A composer: the prompt with one row of parameter chips under it; each chip opens its own small field.
  return (
    <form className="border-b border-line pb-4" onSubmit={(event) => void submit(event)}>
      <div className="rounded-lg border border-line transition-colors focus-within:border-primary/55">
        <textarea
          autoFocus={autoFocus}
          rows={2}
          maxLength={8000}
          aria-label={t({ ko: '대표 프롬프트', en: 'Representative prompt' })}
          placeholder={t({ ko: '대표 프롬프트', en: 'Representative prompt' })}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => void savePrompt()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          className="block w-full resize-y bg-transparent px-3 pt-2 pb-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <ParamChip
            tip={lengthTip}
            ariaLabel={t({ ko: '길이 {value}초', en: 'Length {value} s' }, { value: prefs.seconds })}
            invalid={secondsOver}
            value={<>{prefs.seconds}<span className="text-muted-foreground">{t({ ko: '초', en: 's' })}</span></>}
          >
            <NumberStepperInput autoFocus className="h-8 w-32 font-mono" min={0.1} max={secondsMax ?? undefined} precision={1} aria-label={t({ ko: '길이(초)', en: 'Length (s)' })} value={prefs.seconds} aria-invalid={secondsOver || undefined} onValueCommit={(value) => set({ seconds: value })} />
          </ParamChip>
          <ParamChip
            tip={t({ ko: '개수: 한 번에 만들 후보 수 (1–50)', en: 'Count: candidates per run (1–50)' })}
            ariaLabel={t({ ko: '개수 {value}', en: 'Count {value}' }, { value: prefs.count })}
            value={<><span className="text-muted-foreground">×</span>{prefs.count}</>}
          >
            <NumberStepperInput autoFocus className="h-8 w-32 font-mono" min={1} max={50} precision={0} aria-label={t({ ko: '개수', en: 'Count' })} value={prefs.count} onValueCommit={(value) => set({ count: value })} />
          </ParamChip>
          <ParamChip
            tip={t({ ko: 'seed: 비워두면 매번 랜덤', en: 'Seed: leave empty for a random one each time' })}
            ariaLabel={seedText ? `seed ${seedText}` : t({ ko: 'seed 랜덤', en: 'seed: random' })}
            value={<><Dices className="size-3.5 text-muted-foreground" />{seedText ? <span className="max-w-20 truncate">{seedText}</span> : null}</>}
          >
            <Input autoFocus className="h-8 w-36 font-mono" inputMode="numeric" aria-label="seed" placeholder={t({ ko: 'seed 랜덤', en: 'seed: random' })} value={prefs.seed} onChange={(event) => set({ seed: event.target.value })} />
          </ParamChip>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {chip}
            {fix}
          </div>
          <IconButton type="submit" variant="default" size="icon-sm" disabled={!runnable || !valid || busy !== null} label={t({ ko: '{count}개 생성', en: 'Generate {count}' }, { count: Number.isInteger(count) && count > 0 ? count : 0 })}>
            <Sparkles />
          </IconButton>
        </div>
      </div>
    </form>
  )
}

/** One parameter in the composer row: its value as a small chip that opens the field to change it. */
function ParamChip({ tip, ariaLabel, invalid = false, value, children }: { tip: string; ariaLabel: string; invalid?: boolean; value: ReactNode; children: ReactNode }) {
  return (
    <Popover>
      <Tip content={tip}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="xs" aria-label={ariaLabel} aria-invalid={invalid || undefined} className={cn('shrink-0 gap-0.5 font-mono font-normal tabular-nums', invalid && 'text-destructive')}>
            {value}
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="start" className="w-auto p-2">
        {children}
      </PopoverContent>
    </Popover>
  )
}

function StatusChip({ tone = 'idle', icon, children }: { tone?: 'idle' | 'warn' | 'bad'; icon?: ReactNode; children: ReactNode }) {
  return (
    <Chip tone="muted" className="h-6 shrink gap-1.5 px-2">
      {icon ?? <span className={cn('size-1.5 shrink-0 rounded-full', tone === 'bad' ? 'bg-destructive' : tone === 'warn' ? 'bg-warning' : 'bg-muted-foreground/50')} aria-hidden />}
      <span className="truncate">{children}</span>
    </Chip>
  )
}
