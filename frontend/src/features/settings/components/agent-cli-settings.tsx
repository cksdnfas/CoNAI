import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { AgentCliName } from '@conai/shared'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { CodexDeviceLoginDialog } from '@/features/image-generation/components/codex-device-login-dialog'
import { getCodexCliVersion, updateCodexCli } from '@/lib/api-image-generation-queue'
import { cancelClaudeLogin, getAgentCliStatus, getAgentCliVersion, getClaudeLogin, startClaudeLogin, submitClaudeLoginCode, updateAgentCli } from '@/lib/api-agent-cli'

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
          <p className="text-sm text-muted-foreground">{t({ ko: '인증 페이지에서 로그인해줘. 인증 코드가 표시되면 아래에 붙여넣어줘.', en: 'Sign in on the authentication page. If it shows an authorization code, paste it below.' })}</p>
          <Button asChild><a href={state.verificationUrl} target="_blank" rel="noopener noreferrer">{t({ ko: '인증 페이지 열기', en: 'Open authentication page' })}</a></Button>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (code.trim()) submit.mutate(code.trim()) }}>
            <Input type="password" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" aria-label={t({ ko: '인증 코드', en: 'Authorization code' })} placeholder={t({ ko: '인증 코드', en: 'Authorization code' })} />
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

function AgentCliRow({ agent }: { agent: AgentCliName }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const [loginOpen, setLoginOpen] = useState(false)
  const name = agent === 'codex' ? 'Codex' : 'Claude Code'
  const versionKey = [agent === 'codex' ? 'codex-cli-version' : 'claude-cli-version']
  const status = useQuery({ queryKey: ['agent-cli-status', agent], queryFn: () => getAgentCliStatus(agent), retry: false, refetchInterval: 30000 })
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
    onSuccess: (result) => { queryClient.setQueryData(versionKey, result); refreshStatus() },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '상태 확인 실패', en: 'Status check failed' }), tone: 'error' }),
  })
  const info = version.data?.data
  const busy = update.isPending || info?.updating === true
  const installOrUpdate = async () => {
    const allowed = await confirm({ title: t({ ko: '{name} 설치/업데이트', en: 'Install/update {name}' }, { name }), description: t({ ko: '진행 중인 작업이 있으면 업데이트할 수 없어. 서버에 최신 버전을 설치할까?', en: 'Updates are blocked while work is running. Install the latest version on the server?' }), confirmLabel: t({ ko: '설치/업데이트', en: 'Install/update' }) })
    if (allowed) update.mutate()
  }
  const stateLabel = status.isPending ? t({ ko: '확인 중', en: 'Checking' }) : status.isError ? t({ ko: '확인 실패', en: 'Check failed' }) : !status.data?.installed ? t({ ko: '미설치', en: 'Not installed' }) : status.data.authenticated ? t({ ko: '인증됨', en: 'Authenticated' }) : t({ ko: '로그인 필요', en: 'Sign-in required' })
  return <>
    <SettingRow label={name} description={<>
      <span>{stateLabel}{info?.current ? ` · v${info.current}` : ''}{status.data?.authMethod ? ` · ${status.data.authMethod}` : ''}</span>
      {info?.latest ? <span>{t({ ko: ' · 최신 {version}', en: ' · latest {version}' }, { version: info.latest })}</span> : null}
      {(status.error || version.error || status.data?.message || info?.message) ? <p className="text-destructive">{status.error instanceof Error ? status.error.message : version.error instanceof Error ? version.error.message : status.data?.message ?? info?.message}</p> : null}
    </>}>
      <IconButton variant="ghost" size="icon-sm" disabled={busy || refresh.isPending} label={t({ ko: '{name} 상태 새로고침', en: 'Refresh {name} status' }, { name })} onClick={() => refresh.mutate()}><RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} /></IconButton>
      <Button variant="secondary" size="sm" disabled={busy || !status.data?.installed} onClick={() => setLoginOpen(true)}>{status.data?.authenticated ? t({ ko: '다시 로그인', en: 'Sign in again' }) : t({ ko: '로그인', en: 'Sign in' })}</Button>
      <Button variant="secondary" size="sm" disabled={busy || version.isPending || Boolean(info?.current && !info.updateAvailable)} onClick={() => void installOrUpdate()}>{busy ? t({ ko: '업데이트 중…', en: 'Updating…' }) : !info?.current ? t({ ko: '설치', en: 'Install' }) : t({ ko: '업데이트', en: 'Update' })}</Button>
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
