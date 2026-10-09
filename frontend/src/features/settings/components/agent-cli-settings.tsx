import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2, LogIn, RefreshCw } from 'lucide-react'
import type { AgentCliName, AgentCliUsageWindow } from '@conai/shared'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { CodexDeviceLoginDialog } from '@/features/image-generation/components/codex-device-login-dialog'
import { getCodexCliVersion, updateCodexCli } from '@/lib/api-image-generation-queue'
import { cancelClaudeLogin, getAgentCliStatus, getAgentCliUsage, getAgentCliVersion, getClaudeLogin, startClaudeLogin, submitClaudeLoginCode, updateAgentCli } from '@/lib/api-agent-cli'

function ClaudeLoginDialog({ open, onClose, onSucceeded }: { open: boolean; onClose: () => void; onSucceeded: () => void }) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const queryClient = useQueryClient()
  const succeeded = useRef(false)
  const active = useRef(false)
  const start = useMutation({ mutationFn: startClaudeLogin, onSuccess: (value) => { if (!active.current) { void cancelClaudeLogin().catch(() => {}); return }; queryClient.setQueryData(['claude-cli-login'], value) } })
  const { mutate, reset } = start
  const login = useQuery({ queryKey: ['claude-cli-login'], queryFn: getClaudeLogin, enabled: open && start.isSuccess, refetchInterval: (query) => ['pending', 'starting'].includes(query.state.data?.status ?? '') ? 2000 : false, retry: false })
  const submit = useMutation({ mutationFn: submitClaudeLoginCode, onSuccess: () => { setCode(''); void login.refetch() } })
  const state = start.isSuccess ? login.data ?? start.data : null
  useEffect(() => {
    if (!open) return
    active.current = true
    succeeded.current = false
    mutate()
    return () => { active.current = false; reset(); queryClient.removeQueries({ queryKey: ['claude-cli-login'] }) }
  }, [open, mutate, reset, queryClient])
  useEffect(() => {
    if (open && state?.status === 'succeeded' && !succeeded.current) { succeeded.current = true; onSucceeded(); onClose() }
  }, [open, state?.status, onSucceeded, onClose])
  const close = () => { if (start.isPending || state?.status === 'pending') void cancelClaudeLogin().catch(() => {}); setCode(''); submit.reset(); onClose() }
  const error = start.error ?? submit.error ?? login.error
  return <Modal open={open} onClose={close} title={t({ ko: 'Claude Code 로그인', en: 'Claude Code sign-in' })} widthClassName="max-w-md">
    <ModalBody>
      <div className="space-y-4">
        {state?.status === 'pending' && state.verificationUrl ? <>
          <Button asChild><a href={state.verificationUrl} target="_blank" rel="noopener noreferrer">{t({ ko: '인증 페이지 열기', en: 'Open authentication page' })}</a></Button>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (code.trim()) submit.mutate(code.trim()) }}>
            <Input type="password" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" aria-label={t({ ko: '인증 코드', en: 'Authorization code' })} placeholder={t({ ko: '코드가 나오면 붙여넣어', en: 'Paste the code if one shows' })} />
            <Button type="submit" disabled={!code.trim() || submit.isPending}>{t({ ko: '확인', en: 'Submit' })}</Button>
          </form>
        </> : !error && state?.status !== 'failed' ? <p className="text-sm text-muted-foreground">{t({ ko: '로그인 준비 중…', en: 'Preparing sign-in…' })}</p> : null}
        {error || state?.status === 'failed' ? <>
          <p className="text-sm text-destructive">{error instanceof Error ? error.message : state?.message}</p>
          <Button onClick={() => { submit.reset(); mutate() }} disabled={start.isPending}>{t({ ko: '다시 시도', en: 'Try again' })}</Button>
        </> : null}
      </div>
    </ModalBody>
  </Modal>
}

function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/** Subscription windows as thin gauges: name, fill, percent, then when the window resets. */
export function AgentCliUsageBars({ windows }: { windows: AgentCliUsageWindow[] }) {
  const { t } = useI18n()
  const now = useMinuteClock()
  const windowLabel = (entry: AgentCliUsageWindow) => {
    const span = entry.window === 'weekly' ? t({ ko: '주간', en: 'Weekly' }) : entry.minutes && entry.minutes % 60 === 0 ? t({ ko: '{hours}시간', en: '{hours}h' }, { hours: entry.minutes / 60 }) : t({ ko: '세션', en: 'Session' })
    if (!entry.model) return span
    return entry.window === 'weekly' ? entry.model : `${entry.model} ${span}`
  }
  const resetLabel = (resetsAt: string | null) => {
    if (!resetsAt) return null
    const at = new Date(resetsAt)
    const minutes = Math.ceil((at.getTime() - now) / 60000)
    if (minutes <= 0) return t({ ko: '곧 리셋', en: 'Resetting' })
    if (minutes < 1440) {
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return hours ? t({ ko: '{hours}시간 {minutes}분 뒤', en: 'in {hours}h {minutes}m' }, { hours, minutes: rest }) : t({ ko: '{minutes}분 뒤', en: 'in {minutes}m' }, { minutes: rest })
    }
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${at.getMonth() + 1}/${at.getDate()} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  }
  return <div className="mt-1.5 grid w-fit grid-cols-[auto_6rem_2.25rem_auto] items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[auto_8rem_2.25rem_auto]">
    {windows.map((entry) => <div key={entry.id} className="contents">
      <span>{windowLabel(entry)}</span>
      <span className="h-1 overflow-hidden rounded-full bg-foreground/10" role="meter" aria-label={windowLabel(entry)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.usedPercent}>
        <span className={`block h-full rounded-full ${entry.usedPercent >= 100 ? 'bg-destructive' : entry.usedPercent >= 80 ? 'bg-warning' : 'bg-foreground/60'}`} style={{ width: `${entry.usedPercent}%` }} />
      </span>
      <span className="text-right tabular-nums text-foreground">{entry.usedPercent}%</span>
      <span className="tabular-nums">{resetLabel(entry.resetsAt)}</span>
    </div>)}
  </div>
}

function AgentCliRow({ agent }: { agent: AgentCliName }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const [loginOpen, setLoginOpen] = useState(false)
  const name = agent === 'codex' ? 'Codex' : 'Claude Code'
  const versionKey = [agent === 'codex' ? 'codex-cli-version' : 'claude-cli-version']
  const status = useQuery({ queryKey: ['agent-cli-status', agent], queryFn: () => getAgentCliStatus(agent), retry: false, refetchInterval: 30000 })
  const authenticated = status.data?.authenticated === true
  const usage = useQuery({ queryKey: ['agent-cli-usage', agent], queryFn: () => getAgentCliUsage(agent), enabled: authenticated, retry: false, refetchInterval: 300000 })
  const version = useQuery({ queryKey: versionKey, queryFn: () => agent === 'codex' ? getCodexCliVersion() : getAgentCliVersion(agent).then((data) => ({ success: true, data })), retry: false, staleTime: 3600000 })
  const refreshStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['agent-cli-status', agent] })
    void queryClient.invalidateQueries({ queryKey: ['codex-generation-status'] })
    void queryClient.invalidateQueries({ queryKey: ['codex-chat-status'] })
    void queryClient.invalidateQueries({ queryKey: ['codex-chat-profiles'] })
  }, [agent, queryClient])
  const closeLogin = useCallback(() => setLoginOpen(false), [])
  const update = useMutation({
    mutationFn: () => agent === 'codex' ? updateCodexCli() : updateAgentCli(agent).then((data) => ({ success: true, data })),
    onSuccess: (result) => { queryClient.setQueryData(versionKey, result); refreshStatus(); showSnackbar({ message: t({ ko: '{name} 설치/업데이트 완료', en: '{name} installed/updated' }, { name }), tone: 'info' }) },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '업데이트 실패', en: 'Update failed' }), tone: 'error' }),
  })
  const refresh = useMutation({
    mutationFn: () => agent === 'codex' ? getCodexCliVersion({ refresh: true }) : getAgentCliVersion(agent, true).then((data) => ({ success: true, data })),
    onSuccess: (result) => {
      queryClient.setQueryData(versionKey, result)
      refreshStatus()
      void getAgentCliUsage(agent, true).then((data) => queryClient.setQueryData(['agent-cli-usage', agent], data)).catch(() => {})
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '상태 확인 실패', en: 'Status check failed' }), tone: 'error' }),
  })
  const info = version.data?.data
  const busy = update.isPending || info?.updating === true
  const installOrUpdate = async () => {
    const allowed = await confirm({ title: t({ ko: '{name} 설치/업데이트', en: 'Install/update {name}' }, { name }), description: t({ ko: '진행 중인 작업이 있으면 업데이트할 수 없어. 서버에 최신 버전을 설치할까?', en: 'Updates are blocked while work is running. Install the latest version on the server?' }), confirmLabel: t({ ko: '설치/업데이트', en: 'Install/update' }) })
    if (allowed) update.mutate()
  }
  const stateLabel = status.isPending ? t({ ko: '확인 중', en: 'Checking' }) : status.isError ? t({ ko: '확인 실패', en: 'Check failed' }) : !status.data?.installed ? t({ ko: '미설치', en: 'Not installed' }) : status.data.authenticated ? t({ ko: '인증됨', en: 'Authenticated' }) : t({ ko: '로그인 필요', en: 'Sign-in required' })
  const usageWindows = authenticated ? usage.data?.windows ?? [] : []
  return <>
    <SettingRow align={usageWindows.length ? 'start' : 'center'} label={<>
      {/* The state stays visible (it is the row's answer); version details live in its tooltip. */}
      <span className="flex items-center gap-2">
        {name}
        <Tip content={[info?.current ? `v${info.current}` : null, status.data?.authMethod ?? null, info?.latest ? t({ ko: '최신 {version}', en: 'latest {version}' }, { version: info.latest }) : null].filter(Boolean).join(' · ')}>
          <span className="text-xs text-muted-foreground">{stateLabel}</span>
        </Tip>
      </span>
      {(status.error || version.error || status.data?.message || info?.message) ? <span className="mt-0.5 block text-xs text-destructive">{status.error instanceof Error ? status.error.message : version.error instanceof Error ? version.error.message : status.data?.message ?? info?.message}</span> : null}
      {usageWindows.length ? <AgentCliUsageBars windows={usageWindows} /> : authenticated && usage.data?.message ? <span className="mt-0.5 block text-xs text-muted-foreground">{usage.data.message}</span> : null}
    </>}>
      <IconButton variant="ghost" size="icon-sm" disabled={busy || refresh.isPending} label={t({ ko: '{name} 상태 새로고침', en: 'Refresh {name} status' }, { name })} onClick={() => refresh.mutate()}><RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} /></IconButton>
      <IconButton variant="secondary" size="icon-sm" disabled={busy || !status.data?.installed} onClick={() => setLoginOpen(true)} label={status.data?.authenticated ? t({ ko: '{name} 다시 로그인', en: 'Sign in to {name} again' }, { name }) : t({ ko: '{name} 로그인', en: 'Sign in to {name}' }, { name })}><LogIn /></IconButton>
      <IconButton variant="secondary" size="icon-sm" disabled={busy || version.isPending || Boolean(info?.current && !info.updateAvailable)} onClick={() => void installOrUpdate()} label={busy ? t({ ko: '업데이트 중…', en: 'Updating…' }) : !info?.current ? t({ ko: '{name} 설치', en: 'Install {name}' }, { name }) : info.updateAvailable ? t({ ko: '{name} 업데이트', en: 'Update {name}' }, { name }) : t({ ko: '이미 최신 버전', en: 'Already up to date' })}>{busy ? <Loader2 className="animate-spin" /> : <Download />}</IconButton>
    </SettingRow>
    {agent === 'codex' ? <CodexDeviceLoginDialog open={loginOpen} onClose={closeLogin} onSucceeded={refreshStatus} /> : <ClaudeLoginDialog open={loginOpen} onClose={closeLogin} onSucceeded={refreshStatus} />}
  </>
}

export function AgentCliSettings() {
  const { t } = useI18n()
  const auth = useAuthStatusQuery()
  if (auth.data?.isAdmin !== true) return null
  return <RowGroup heading={t({ ko: 'CLI 인증과 업데이트', en: 'CLI authentication and updates' })}>
    <AgentCliRow agent="codex" />
    <AgentCliRow agent="claude" />
  </RowGroup>
}
