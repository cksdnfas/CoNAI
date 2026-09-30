import { spawn, type ChildProcess } from 'child_process'
import { runtimePaths } from '../config/runtimePaths'
import { killCodexProcessTree, resolveCodexCommand, scheduleCodexProcessTimeout } from './codexGenerationExecutor'

export type CodexDeviceLoginStatus = 'idle' | 'starting' | 'pending' | 'succeeded' | 'failed' | 'cancelled'

export type CodexDeviceLoginState = {
  status: CodexDeviceLoginStatus
  verificationUrl: string | null
  userCode: string | null
  expiresAt: string | null
  message: string | null
}

// CLI가 코드를 출력하기까지 기다리는 시간. 넘기면 네트워크/CLI 문제로 본다.
const CODEX_DEVICE_CODE_WAIT_MS = 30 * 1000
// 디바이스 코드는 15분 뒤 만료된다. 그보다 조금 길게 잡아 CLI가 스스로 만료를 알리게 둔다.
const CODEX_DEVICE_LOGIN_TIMEOUT_MS = 16 * 60 * 1000
const CODEX_OUTPUT_TAIL_LENGTH = 600

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g
const VERIFICATION_URL_PATTERN = /https:\/\/[^\s]+/
const USER_CODE_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4,}\b/
const EXPIRES_IN_MINUTES_PATTERN = /expires in (\d+) minutes?/i

type CodexDeviceLoginSession = {
  child: ChildProcess
  cancelled: boolean
  codeReady: Promise<void>
}

let state: CodexDeviceLoginState = {
  status: 'idle',
  verificationUrl: null,
  userCode: null,
  expiresAt: null,
  message: null,
}
let session: CodexDeviceLoginSession | null = null

function isActive(status: CodexDeviceLoginStatus) {
  return status === 'starting' || status === 'pending'
}

function settle(next: Pick<CodexDeviceLoginState, 'status' | 'message'>) {
  state = { ...state, ...next, verificationUrl: null, userCode: null, expiresAt: null }
}

function tailOutput(output: string) {
  const trimmed = output.trim()
  return trimmed.length > CODEX_OUTPUT_TAIL_LENGTH ? `…${trimmed.slice(-CODEX_OUTPUT_TAIL_LENGTH)}` : trimmed
}

export function getCodexDeviceLoginState(): CodexDeviceLoginState {
  return { ...state }
}

/**
 * `codex login --device-auth`를 서버에서 띄우고 인증 URL·일회용 코드가 나올 때까지 기다린다.
 * 진행 중인 로그인이 있으면 새로 띄우지 않고 그 상태를 돌려준다. CLI는 승인될 때까지 폴링하다가 스스로 종료한다.
 */
export async function startCodexDeviceLogin(): Promise<CodexDeviceLoginState> {
  if (session && isActive(state.status)) {
    await session.codeReady
    return getCodexDeviceLoginState()
  }

  const resolvedCommand = resolveCodexCommand()
  state = { status: 'starting', verificationUrl: null, userCode: null, expiresAt: null, message: null }

  const child = spawn(resolvedCommand.command, [...resolvedCommand.prefixArgs, 'login', '--device-auth'], {
    cwd: runtimePaths.tempDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
    windowsHide: true,
    // POSIX에서는 프로세스 그룹째 종료하려고 detached로 띄운다.
    detached: process.platform !== 'win32',
  })

  let resolveCodeReady: () => void = () => {}
  const codeReady = new Promise<void>((resolve) => {
    resolveCodeReady = resolve
  })
  const currentSession: CodexDeviceLoginSession = { child, cancelled: false, codeReady }
  session = currentSession

  const processTimeout = scheduleCodexProcessTimeout(child, CODEX_DEVICE_LOGIN_TIMEOUT_MS)
  let codeWaitExpired = false
  const codeWaitTimer = setTimeout(() => {
    if (state.status === 'starting' && session === currentSession) {
      codeWaitExpired = true
      killCodexProcessTree(child, 'SIGKILL')
    }
  }, CODEX_DEVICE_CODE_WAIT_MS)
  codeWaitTimer.unref()

  let stdout = ''
  let stderr = ''

  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString()
    if (state.status !== 'starting' || session !== currentSession) {
      return
    }

    const plainOutput = stdout.replace(ANSI_ESCAPE_PATTERN, '')
    const verificationUrl = plainOutput.match(VERIFICATION_URL_PATTERN)?.[0] ?? null
    const userCode = plainOutput.match(USER_CODE_PATTERN)?.[0] ?? null
    if (!verificationUrl || !userCode) {
      return
    }

    const expiresInMinutes = Number(plainOutput.match(EXPIRES_IN_MINUTES_PATTERN)?.[1] ?? 15)
    state = {
      status: 'pending',
      verificationUrl,
      userCode,
      expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString(),
      message: null,
    }
    clearTimeout(codeWaitTimer)
    resolveCodeReady()
  })

  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const finish = (next: Pick<CodexDeviceLoginState, 'status' | 'message'>) => {
    processTimeout.clear()
    clearTimeout(codeWaitTimer)
    if (session === currentSession) {
      settle(next)
      session = null
    }
    resolveCodeReady()
  }

  child.once('error', (error) => {
    finish({ status: 'failed', message: `Codex command unavailable: ${error.message}` })
  })

  child.once('close', (code) => {
    if (currentSession.cancelled) {
      finish({ status: 'cancelled', message: null })
      return
    }

    if (code === 0) {
      finish({ status: 'succeeded', message: null })
      return
    }

    const output = tailOutput(`${stdout}\n${stderr}`.replace(ANSI_ESCAPE_PATTERN, ''))
    const message = processTimeout.timedOut
      ? 'Codex device code expired before it was approved'
      : codeWaitExpired
        ? `Codex did not print a device code within ${CODEX_DEVICE_CODE_WAIT_MS / 1000}s`
        : output || `codex login exited with code ${code ?? 'unknown'}`
    finish({ status: 'failed', message })
  })

  await codeReady
  return getCodexDeviceLoginState()
}

/** 진행 중인 디바이스 로그인을 끝낸다. 이미 끝났으면 현재 상태만 돌려준다. */
export function cancelCodexDeviceLogin(): CodexDeviceLoginState {
  if (session && isActive(state.status)) {
    session.cancelled = true
    killCodexProcessTree(session.child, 'SIGTERM')
    // close 이벤트를 기다리지 않고 바로 끝난 상태로 돌려, 곧바로 다시 시작할 수 있게 한다.
    settle({ status: 'cancelled', message: null })
    session = null
  }

  return getCodexDeviceLoginState()
}
