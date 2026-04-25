import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { runtimePaths } from '../config/runtimePaths'
import { assertCodexAvailable, resolveCodexCommand } from './codexGenerationExecutor'

const CODEX_MESSAGE_JOB_ROOT = path.join(runtimePaths.tempDir, 'codex-message-jobs')
const CODEX_CANCELLED_MESSAGE = '__CODEX_MESSAGE_CANCELLED__'
const DEFAULT_CODEX_TIMEOUT_MS = 10 * 60 * 1000

type CodexResponseMode = 'text' | 'json'

export type ExecuteCodexMessageRequest = {
  prompt: string
  systemPrompt?: string | null
  context?: string | null
  model?: string | null
  responseMode?: CodexResponseMode | null
  shouldCancel?: () => boolean
  timeoutMs?: number
}

export type ExecuteCodexMessageResponse = {
  text: string
  json: unknown | null
  model: string | null
  responseMode: CodexResponseMode
  metadata: Record<string, unknown>
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeResponseMode(value: unknown): CodexResponseMode {
  return value === 'json' ? 'json' : 'text'
}

function parseCodexSessionId(output: string) {
  const match = output.match(/session id:\s*([^\s]+)/i)
  return match?.[1]?.trim() || null
}

function buildPromptBlock(label: string, value: string | null) {
  if (!value) {
    return null
  }

  return `${label}:\n<<<${label}>>>\n${value}\n<<<end_${label}>>>`
}

function buildCodexMessagePrompt(params: {
  prompt: string
  systemPrompt: string | null
  contextValue: string | null
  responseMode: CodexResponseMode
}) {
  const responseInstruction = params.responseMode === 'json'
    ? 'Return valid JSON only. Do not wrap it in markdown fences or extra prose.'
    : 'Return the final answer as plain text. Do not wrap it in markdown fences unless the content itself requires it.'

  return [
    'You are replying for a CoNAI graph node execution.',
    'This is a one-shot task running in an isolated scratch directory.',
    'Do not modify repository files or rely on git state.',
    responseInstruction,
    buildPromptBlock('system_prompt', params.systemPrompt),
    buildPromptBlock('context', params.contextValue),
    buildPromptBlock('user_prompt', params.prompt),
  ].filter((line): line is string => Boolean(line)).join('\n\n')
}

async function runCodexExec(params: {
  workDir: string
  prompt: string
  model: string | null
  shouldCancel?: () => boolean
  timeoutMs: number
}) {
  const stdoutPath = path.join(params.workDir, 'codex-output.jsonl')
  const stderrPath = path.join(params.workDir, 'codex-stderr.log')
  const lastMessagePath = path.join(params.workDir, 'codex-last-message.txt')
  const resolvedCommand = resolveCodexCommand()

  const args = [
    ...resolvedCommand.prefixArgs,
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--sandbox',
    'workspace-write',
    '--json',
    '--output-last-message',
    lastMessagePath,
  ]

  if (params.model) {
    args.push('--model', params.model)
  }

  args.push(params.prompt)

  return await new Promise<{ stdoutPath: string; stderrPath: string; lastMessage: string | null; sessionId: string | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(resolvedCommand.command, args, {
      cwd: params.workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    })

    const stdoutStream = fs.createWriteStream(stdoutPath)
    const stderrStream = fs.createWriteStream(stderrPath)
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let cancelled = false

    const finalizeReject = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      clearInterval(cancelInterval)
      clearTimeout(timeoutHandle)
      stdoutStream.end()
      stderrStream.end()
      reject(error)
    }

    const finalizeResolve = async () => {
      if (settled) {
        return
      }
      settled = true
      clearInterval(cancelInterval)
      clearTimeout(timeoutHandle)
      stdoutStream.end()
      stderrStream.end()

      let lastMessage: string | null = null
      try {
        lastMessage = (await fs.promises.readFile(lastMessagePath, 'utf8')).trim() || null
      } catch {
        lastMessage = null
      }

      resolve({
        stdoutPath,
        stderrPath,
        lastMessage,
        sessionId: parseCodexSessionId(`${stdout}\n${stderr}`),
        stdout,
        stderr,
      })
    }

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        // ignore
      }
    }, params.timeoutMs)

    const cancelInterval = setInterval(() => {
      if (!params.shouldCancel?.()) {
        return
      }

      cancelled = true
      try {
        child.kill()
      } catch {
        // ignore
      }
    }, 750)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      stdoutStream.write(chunk)
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      stderrStream.write(chunk)
    })

    child.once('error', (error) => {
      finalizeReject(new Error(`Failed to launch codex exec: ${error.message}`))
    })

    child.once('close', async (code) => {
      if (cancelled) {
        finalizeReject(new Error(CODEX_CANCELLED_MESSAGE))
        return
      }

      if (timedOut) {
        finalizeReject(new Error(`Codex message execution timed out after ${params.timeoutMs}ms`))
        return
      }

      if (code !== 0) {
        let lastMessage = ''
        try {
          lastMessage = await fs.promises.readFile(lastMessagePath, 'utf8')
        } catch {
          lastMessage = ''
        }

        finalizeReject(new Error([
          `codex exec failed with exit code ${code ?? 'unknown'}`,
          lastMessage.trim() ? `last message: ${lastMessage.trim()}` : null,
          stderr.trim() ? `stderr: ${stderr.trim().slice(-1200)}` : null,
        ].filter(Boolean).join('\n')))
        return
      }

      void finalizeResolve()
    })
  })
}

function parseJsonResult(text: string, responseMode: CodexResponseMode) {
  if (responseMode !== 'json') {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Codex 응답이 JSON 형식이 아니야')
  }
}

export async function executeCodexMessageRequest(request: ExecuteCodexMessageRequest): Promise<ExecuteCodexMessageResponse> {
  const prompt = normalizeOptionalString(request.prompt)
  if (!prompt) {
    throw new Error('Codex 메시지 프롬프트가 비어 있어')
  }

  await assertCodexAvailable('Codex 메시지')
  await fs.promises.mkdir(CODEX_MESSAGE_JOB_ROOT, { recursive: true })
  const workDir = await fs.promises.mkdtemp(path.join(CODEX_MESSAGE_JOB_ROOT, `${Date.now()}-${randomUUID()}-`))
  const responseMode = normalizeResponseMode(request.responseMode)
  const model = normalizeOptionalString(request.model)
  const timeoutMs = typeof request.timeoutMs === 'number' && Number.isFinite(request.timeoutMs)
    ? Math.max(1000, Math.round(request.timeoutMs))
    : DEFAULT_CODEX_TIMEOUT_MS

  const codexPrompt = buildCodexMessagePrompt({
    prompt,
    systemPrompt: normalizeOptionalString(request.systemPrompt),
    contextValue: normalizeOptionalString(request.context),
    responseMode,
  })

  const result = await runCodexExec({
    workDir,
    prompt: codexPrompt,
    model,
    shouldCancel: request.shouldCancel,
    timeoutMs,
  })

  const text = normalizeOptionalString(result.lastMessage) ?? normalizeOptionalString(result.stdout) ?? null
  if (!text) {
    throw new Error('Codex가 텍스트 응답을 남기지 않았어')
  }

  const jsonValue = parseJsonResult(text, responseMode)

  return {
    text,
    json: jsonValue,
    model,
    responseMode,
    metadata: {
      requested_model: model,
      response_mode: responseMode,
      job_directory: workDir,
      stdout_path: result.stdoutPath,
      stderr_path: result.stderrPath,
      session_id: result.sessionId,
      raw_last_message: result.lastMessage,
    },
  }
}
