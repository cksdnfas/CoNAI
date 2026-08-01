import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { runtimePaths } from '../config/runtimePaths'
import { normalizeBase64ImageData } from '../utils/nai/requestBuilder'

export type CodexGenerationPayload = {
  prompt: string
  model?: string
  negative_prompt?: string
  size?: string
  quality?: string
  background?: 'auto' | 'transparent' | 'opaque'
  output_format?: 'png' | 'jpeg' | 'webp'
  count?: number
  operation?: 'generate' | 'edit' | 'infill'
  image?: string
  mask?: string
}

export type CodexGeneratedArtifact = {
  absolutePath: string
  mimeType: string
}

export type CodexGenerationResult = {
  jobDirectory: string
  outputFiles: CodexGeneratedArtifact[]
  lastMessage: string | null
  stdoutPath: string
  stderrPath: string
}

export type CodexAvailabilityStatus = {
  installed: boolean
  authenticated: boolean
  available: boolean
  authMode: string | null
  command: string
  rawOutput: string
  message: string
  exitCode: number | null
}

// Hung Codex processes would otherwise hold their queue concurrency slot forever.
const CODEX_AVAILABILITY_TIMEOUT_MS = 10000
const CODEX_EXEC_TIMEOUT_MS = 30 * 60 * 1000
// SIGTERM으로 래퍼가 스스로 정리할 시간을 준 뒤 트리를 강제 종료한다.
const CODEX_KILL_GRACE_MS = 5000

const SUPPORTED_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp'])
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const CODEX_AUTHENTICATED_PATTERN = /(^|\n)\s*logged in using\s+(.+)/i
const CODEX_UNAUTHENTICATED_PATTERNS = [
  /(^|\n)\s*not logged in\b/i,
  /(^|\n)\s*login required\b/i,
  /(^|\n)\s*authentication required\b/i,
  /(^|\n)\s*unauthenticated\b/i,
  /(^|\n)\s*no stored credentials\b/i,
] as const

function resolveOutputFormat(value: string | undefined) {
  if (!value) {
    return 'png' as const
  }

  return SUPPORTED_OUTPUT_FORMATS.has(value) ? value as 'png' | 'jpeg' | 'webp' : 'png'
}

function resolveOutputExtension(format: 'png' | 'jpeg' | 'webp') {
  return format === 'jpeg' ? 'jpg' : format
}

function buildRequestedOutputFileNames(count: number | undefined, outputFormat: string | undefined) {
  const requestedCount = Math.max(1, Math.min(count ?? 1, 4))
  const resolvedFormat = resolveOutputFormat(outputFormat)
  const outputExtension = resolveOutputExtension(resolvedFormat)

  return Array.from({ length: requestedCount }, (_, index) => `codex-output-${String(index + 1).padStart(2, '0')}.${outputExtension}`)
}

export function resolveCodexJobRoot() {
  return path.join(runtimePaths.tempDir, 'codex-jobs')
}

function resolveImageMimeType(extension: string) {
  switch (extension.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    default:
      return 'image/png'
  }
}

function parseSize(size: string | undefined) {
  if (typeof size !== 'string') {
    return null
  }

  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(size.trim())
  if (!match) {
    return null
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  }
}

function decodeDataUrl(dataUrl: string) {
  const normalized = normalizeBase64ImageData(dataUrl)
  if (!normalized) {
    throw new Error('Image payload is empty')
  }

  const mimeMatch = /^data:([^;]+);base64,/i.exec(dataUrl)
  const mimeType = mimeMatch?.[1]?.toLowerCase() ?? 'image/png'
  const base64 = normalized

  let extension = '.png'
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    extension = '.jpg'
  } else if (mimeType === 'image/webp') {
    extension = '.webp'
  }

  return {
    buffer: Buffer.from(base64, 'base64'),
    mimeType,
    extension,
  }
}

async function writeAttachedImage(jobDirectory: string, basename: string, dataUrl: string) {
  const decoded = decodeDataUrl(dataUrl)
  const targetPath = path.join(jobDirectory, `${basename}${decoded.extension}`)
  await fs.promises.writeFile(targetPath, decoded.buffer)
  return targetPath
}

function buildCodexPrompt(payload: CodexGenerationPayload, outputFileNames: string[]) {
  const size = parseSize(payload.size)
  const operation = payload.operation ?? 'generate'
  const requestedCount = Math.max(1, Math.min(payload.count ?? 1, 4))

  const lines = [
    'Generate image files for CoNAI using Codex built-in image generation capabilities.',
    'Do not write code or scripts to synthesize images manually.',
    'Use the current working directory as the delivery directory.',
    'If any tool saves the image elsewhere first, copy the final deliverables back into the current working directory with the exact filenames below.',
    `Create exactly ${requestedCount} final image file(s): ${outputFileNames.join(', ')}`,
    'Do not create extra deliverable files beyond the requested outputs.',
    '',
    `Operation: ${operation}`,
    `Prompt: ${payload.prompt}`,
  ]

  if (payload.model?.trim()) {
    lines.push(`Model hint: ${payload.model.trim()}`)
  }

  if (payload.negative_prompt?.trim()) {
    lines.push(`Avoid: ${payload.negative_prompt.trim()}`)
  }

  if (size) {
    lines.push(`Preferred size: ${size.width}x${size.height}`)
  }

  if (payload.quality?.trim()) {
    lines.push(`Quality hint: ${payload.quality.trim()}`)
  }

  if (payload.background?.trim()) {
    lines.push(`Background hint: ${payload.background.trim()}`)
  }

  if (payload.output_format?.trim()) {
    lines.push(`Output format hint: ${payload.output_format.trim()}`)
  }

  if (payload.image && payload.mask) {
    lines.push('Attached inputs: the first attached image is the reference image and the second attached image is the edit mask. White mask regions are editable; dark regions should stay preserved when supported.')
  } else if (payload.image) {
    lines.push('Attached inputs: the first attached image is the reference image to edit or match.')
  }

  lines.push('', 'After the requested files exist, reply with ONLY: DONE')
  return lines.join('\n')
}

export function resolveCodexCommand() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    const npmCodexJsPath = path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    if (fs.existsSync(npmCodexJsPath)) {
      return {
        command: process.execPath,
        prefixArgs: [npmCodexJsPath],
      }
    }

    const npmCodexCmdPath = path.join(appData, 'npm', 'codex.cmd')
    if (fs.existsSync(npmCodexCmdPath)) {
      return {
        command: npmCodexCmdPath,
        prefixArgs: [] as string[],
      }
    }
  }

  return {
    command: 'codex',
    prefixArgs: [] as string[],
  }
}

/**
 * spawn 내장 timeout은 직계 자식만 SIGKILL 해서, win32 래퍼(node codex.js)가 띄운 실제
 * codex.exe가 고아로 남는다. 프로세스 트리 전체를 종료한다.
 */
function killCodexProcessTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL') {
  const pid = child.pid
  if (typeof pid !== 'number' || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  const killDirectChild = () => {
    try {
      child.kill(signal)
    } catch {
      // 이미 종료된 프로세스는 무시
    }
  }

  if (process.platform === 'win32') {
    // Windows는 시그널 전달이 없어 SIGTERM/SIGKILL 모두 TerminateProcess다.
    // 래퍼의 핸들러가 돌 수 없으니 taskkill /T /F로 자식까지 함께 정리한다.
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('error', killDirectChild)
    } catch {
      killDirectChild()
    }
    return
  }

  try {
    // detached로 띄웠기 때문에 음수 pid는 프로세스 그룹 전체를 가리킨다.
    process.kill(-pid, signal)
  } catch {
    killDirectChild()
  }
}

type CodexProcessTimeout = {
  readonly timedOut: boolean
  clear: () => void
}

/** 지정 시간이 지나면 SIGTERM → 유예 후 강제 종료 순으로 codex 프로세스 트리를 정리한다. */
function scheduleCodexProcessTimeout(child: ChildProcess, timeoutMs: number): CodexProcessTimeout {
  let timedOut = false
  let escalationTimer: NodeJS.Timeout | null = null

  const timeoutTimer = setTimeout(() => {
    timedOut = true
    killCodexProcessTree(child, 'SIGTERM')
    escalationTimer = setTimeout(() => {
      killCodexProcessTree(child, 'SIGKILL')
    }, CODEX_KILL_GRACE_MS)
    escalationTimer.unref()
  }, timeoutMs)
  timeoutTimer.unref()

  return {
    get timedOut() {
      return timedOut
    },
    clear: () => {
      clearTimeout(timeoutTimer)
      if (escalationTimer) {
        clearTimeout(escalationTimer)
        escalationTimer = null
      }
    },
  }
}

function parseCodexAvailabilityOutput(rawOutput: string, exitCode: number | null, command: string): CodexAvailabilityStatus {
  const authenticatedMatch = rawOutput.match(CODEX_AUTHENTICATED_PATTERN)
  const explicitlyUnauthenticated = CODEX_UNAUTHENTICATED_PATTERNS.some((pattern) => pattern.test(rawOutput))
  const authenticated = Boolean(authenticatedMatch) && !explicitlyUnauthenticated
  const installed = true
  const authMode = authenticatedMatch?.[2]?.trim() ?? null
  const message = authenticated
    ? (authenticatedMatch?.[0]?.trim() || rawOutput || 'Logged in')
    : explicitlyUnauthenticated
      ? 'Codex 로그인 필요: 서버에서 `codex login`이 먼저 완료되어야 해.'
      : (rawOutput || `Codex login status exited with code ${exitCode ?? 'unknown'}`)

  return {
    installed,
    authenticated,
    available: installed && authenticated,
    authMode,
    command,
    rawOutput,
    message,
    exitCode,
  }
}

export async function getCodexAvailabilityStatus(): Promise<CodexAvailabilityStatus> {
  const resolvedCommand = resolveCodexCommand()

  return await new Promise<CodexAvailabilityStatus>((resolve) => {
    const args = [...resolvedCommand.prefixArgs, 'login', 'status']
    let stdout = ''
    let stderr = ''

    const child = spawn(resolvedCommand.command, args, {
      cwd: runtimePaths.tempDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
      // POSIX에서는 프로세스 그룹째 종료하려고 detached로 띄운다.
      detached: process.platform !== 'win32',
    })
    const processTimeout = scheduleCodexProcessTimeout(child, CODEX_AVAILABILITY_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.once('error', (error) => {
      processTimeout.clear()
      resolve({
        installed: false,
        authenticated: false,
        available: false,
        authMode: null,
        command: resolvedCommand.command,
        rawOutput: '',
        message: `Codex command unavailable: ${error.message}`,
        exitCode: null,
      })
    })

    child.once('close', (code, signal) => {
      processTimeout.clear()

      if (processTimeout.timedOut || signal) {
        resolve({
          installed: true,
          authenticated: false,
          available: false,
          authMode: null,
          command: resolvedCommand.command,
          rawOutput: `${stdout}\n${stderr}`.trim(),
          message: processTimeout.timedOut
            ? `Codex login status check timed out after ${CODEX_AVAILABILITY_TIMEOUT_MS / 1000}s and its process tree was killed`
            : `Codex login status check was killed (${signal})`,
          exitCode: null,
        })
        return
      }

      const rawOutput = `${stdout}\n${stderr}`.trim()
      resolve(parseCodexAvailabilityOutput(rawOutput, code, resolvedCommand.command))
    })
  })
}

export async function assertCodexAvailable(actionLabel = 'Codex'): Promise<CodexAvailabilityStatus> {
  const status = await getCodexAvailabilityStatus()

  if (!status.installed) {
    throw new Error(`${actionLabel} 실행 실패: 이 서버에서 Codex CLI를 찾지 못했어.`)
  }

  if (!status.authenticated) {
    throw new Error(`${actionLabel} 실행 실패: ${status.message}`)
  }

  return status
}

async function runCodexExec(jobDirectory: string, prompt: string, imagePaths: string[]) {
  const stdoutPath = path.join(jobDirectory, 'codex-output.jsonl')
  const stderrPath = path.join(jobDirectory, 'codex-stderr.log')
  const lastMessagePath = path.join(jobDirectory, 'codex-last-message.txt')
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

  for (const imagePath of imagePaths) {
    args.push('--image', imagePath)
  }

  args.push('--', prompt)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolvedCommand.command, args, {
      cwd: jobDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
      // POSIX에서는 프로세스 그룹째 종료하려고 detached로 띄운다.
      detached: process.platform !== 'win32',
    })
    const processTimeout = scheduleCodexProcessTimeout(child, CODEX_EXEC_TIMEOUT_MS)

    const stdoutStream = fs.createWriteStream(stdoutPath)
    const stderrStream = fs.createWriteStream(stderrPath)
    let settled = false

    const finalize = (error?: Error) => {
      if (settled) {
        return
      }
      settled = true
      processTimeout.clear()
      stdoutStream.end()
      stderrStream.end()
      if (error) {
        reject(error)
        return
      }
      resolve()
    }

    child.stdout.on('data', (chunk) => {
      stdoutStream.write(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderrStream.write(chunk)
    })

    child.once('error', (error) => {
      finalize(new Error(`Failed to launch codex exec: ${error.message}`))
    })

    child.once('close', async (code, signal) => {
      processTimeout.clear()

      if (code === 0 && !signal && !processTimeout.timedOut) {
        finalize()
        return
      }

      let lastMessage = ''
      try {
        lastMessage = await fs.promises.readFile(lastMessagePath, 'utf8')
      } catch {
        lastMessage = ''
      }

      let stderrTail = ''
      try {
        stderrTail = await fs.promises.readFile(stderrPath, 'utf8')
      } catch {
        stderrTail = ''
      }

      // taskkill로 트리를 정리하면 signal 없이 종료 코드만 남으므로 타임아웃 플래그로 판별한다.
      const failureSummary = processTimeout.timedOut
        ? `codex exec timed out after ${CODEX_EXEC_TIMEOUT_MS / 60000} minutes and its process tree was killed (${signal ?? `exit code ${code ?? 'unknown'}`})`
        : signal
          ? `codex exec was killed (${signal})`
          : `codex exec failed with exit code ${code ?? 'unknown'}`

      finalize(new Error([
        failureSummary,
        lastMessage.trim() ? `last message: ${lastMessage.trim()}` : null,
        stderrTail.trim() ? `stderr: ${stderrTail.trim().slice(-1200)}` : null,
      ].filter(Boolean).join('\n')))
    })
  })

  let lastMessage: string | null = null
  try {
    lastMessage = (await fs.promises.readFile(lastMessagePath, 'utf8')).trim() || null
  } catch {
    lastMessage = null
  }

  return {
    stdoutPath,
    stderrPath,
    lastMessage,
  }
}

async function discoverOutputFiles(jobDirectory: string, requestedFileNames: string[], ignoredBasenames: Set<string>) {
  const preferred = requestedFileNames
    .map((fileName) => path.join(jobDirectory, fileName))
    .filter((filePath) => fs.existsSync(filePath))

  if (preferred.length > 0) {
    return preferred.map((filePath) => ({
      absolutePath: filePath,
      mimeType: resolveImageMimeType(path.extname(filePath)),
    }))
  }

  const entries = await fs.promises.readdir(jobDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(jobDirectory, entry.name))
    .filter((filePath) => {
      const extension = path.extname(filePath).toLowerCase()
      return SUPPORTED_IMAGE_EXTENSIONS.has(extension) && !ignoredBasenames.has(path.basename(filePath))
    })
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({
      absolutePath: filePath,
      mimeType: resolveImageMimeType(path.extname(filePath)),
    }))
}

export async function executeCodexGeneration(payload: CodexGenerationPayload): Promise<CodexGenerationResult> {
  await assertCodexAvailable('Codex 이미지 생성')

  if (typeof payload.prompt !== 'string' || payload.prompt.trim().length === 0) {
    throw new Error('Codex queue payload requires a non-empty prompt')
  }

  const requestedCount = Math.max(1, Math.min(payload.count ?? 1, 4))
  const jobRoot = resolveCodexJobRoot()
  const jobDirectory = path.join(jobRoot, `${Date.now()}-${randomUUID()}`)

  await fs.promises.mkdir(jobDirectory, { recursive: true })

  const attachedImages: string[] = []
  const ignoredBasenames = new Set<string>()

  if (payload.image) {
    const imagePath = await writeAttachedImage(jobDirectory, 'reference-image', payload.image)
    attachedImages.push(imagePath)
    ignoredBasenames.add(path.basename(imagePath))
  }

  if (payload.mask) {
    const maskPath = await writeAttachedImage(jobDirectory, 'mask-image', payload.mask)
    attachedImages.push(maskPath)
    ignoredBasenames.add(path.basename(maskPath))
  }

  const requestedFileNames = buildRequestedOutputFileNames(requestedCount, payload.output_format)
  const prompt = buildCodexPrompt(payload, requestedFileNames)
  await fs.promises.writeFile(path.join(jobDirectory, 'request-prompt.txt'), `${prompt}\n`, 'utf8')

  const runResult = await runCodexExec(jobDirectory, prompt, attachedImages)
  const outputFiles = await discoverOutputFiles(jobDirectory, requestedFileNames, ignoredBasenames)

  if (outputFiles.length === 0) {
    throw new Error(`Codex finished without producing any output files in ${jobDirectory}`)
  }

  return {
    jobDirectory,
    outputFiles: outputFiles.slice(0, requestedCount),
    lastMessage: runResult.lastMessage,
    stdoutPath: runResult.stdoutPath,
    stderrPath: runResult.stderrPath,
  }
}

export const codexGenerationExecutorTestHooks = {
  buildCodexPrompt,
  buildRequestedOutputFileNames,
  discoverOutputFiles,
  parseCodexAvailabilityOutput,
  parseSize,
  resolveCodexJobRoot,
  resolveImageMimeType,
  resolveOutputExtension,
  resolveOutputFormat,
}
