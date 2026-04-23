import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { runtimePaths } from '../config/runtimePaths'

const CODEX_OUTPUT_FILE_NAME = 'output.png'
const CODEX_LAST_MESSAGE_FILE_NAME = 'codex-last-message.txt'
const CODEX_CANCELLED_MESSAGE = '__CODEX_IMAGE_GENERATION_CANCELLED__'
const DEFAULT_CODEX_TIMEOUT_MS = 10 * 60 * 1000
const CODEX_HOME_GENERATED_IMAGES_DIR = path.join(os.homedir(), '.codex', 'generated_images')
const CONAI_CODEX_JOB_ROOT = path.join(runtimePaths.tempDir, 'codex-image-jobs')

export const CODEX_IMAGE_GENERATION_CANCELLED_MESSAGE = CODEX_CANCELLED_MESSAGE

export type CodexImageGenerationParams = {
  prompt: string
  negativePrompt?: string | null
  width?: number | null
  height?: number | null
  contextLabel?: string | null
  shouldCancel?: () => boolean
  timeoutMs?: number
}

export type CodexImageGenerationResult = {
  workDir: string
  outputPath: string
  sessionId: string | null
  lastMessage: string | null
  stdout: string
  stderr: string
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function clampPositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value)
    return rounded > 0 ? rounded : null
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10)
    return parsed > 0 ? parsed : null
  }

  return null
}

function formatPromptBlock(label: string, value: string | null) {
  if (!value) {
    return `${label}: (none)`
  }

  return `${label}:\n<<<${label}>>>\n${value}\n<<<end_${label}>>>`
}

function buildCodexExecutionPrompt(params: CodexImageGenerationParams) {
  const normalizedPrompt = normalizeOptionalString(params.prompt)
  if (!normalizedPrompt) {
    throw new Error('Codex image generation requires a non-empty prompt')
  }

  const normalizedNegativePrompt = normalizeOptionalString(params.negativePrompt)
  const width = clampPositiveInteger(params.width)
  const height = clampPositiveInteger(params.height)
  const sizeLine = width && height
    ? `Target canvas size: ${width}x${height}`
    : 'Target canvas size: use the image generation tool default unless the prompt clearly implies something else.'

  return [
    'Use your built-in image generation capability to create exactly one raster PNG image file named output.png in the current directory.',
    'Do not fake the result with SVG, HTML, CSS, canvas, screenshots, ASCII art, emojis, Pillow-drawn placeholders, or other code-rendered substitutes.',
    'If the built-in image generation capability is unavailable, reply with exactly TOOL_UNAVAILABLE and do not create a fallback image.',
    'If the built-in tool saves elsewhere first, copy or move the final selected image into the current directory as output.png.',
    'Do not modify any repository files and do not rely on git. This directory is an isolated scratch workspace.',
    'After output.png exists and is non-empty, reply with exactly DONE.',
    '',
    params.contextLabel ? `Context: ${params.contextLabel}` : null,
    sizeLine,
    formatPromptBlock('prompt', normalizedPrompt),
    formatPromptBlock('negative_prompt', normalizedNegativePrompt),
  ].filter((line): line is string => Boolean(line)).join('\n')
}

function parseCodexSessionId(output: string) {
  const match = output.match(/session id:\s*([^\s]+)/i)
  return match?.[1]?.trim() || null
}

async function findNewestGeneratedImage(sessionId: string) {
  const sessionDir = path.join(CODEX_HOME_GENERATED_IMAGES_DIR, sessionId)
  let entries: fs.Dirent[] = []

  try {
    entries = await fs.promises.readdir(sessionDir, { withFileTypes: true })
  } catch {
    return null
  }

  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile())
    .filter((entry) => /\.(png|jpg|jpeg|webp)$/i.test(entry.name))
    .map(async (entry) => {
      const fullPath = path.join(sessionDir, entry.name)
      try {
        const stats = await fs.promises.stat(fullPath)
        return {
          fullPath,
          mtimeMs: stats.mtimeMs,
        }
      } catch {
        return null
      }
    }))

  const newest = candidates
    .filter((candidate): candidate is { fullPath: string; mtimeMs: number } => Boolean(candidate))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]

  return newest?.fullPath || null
}

async function ensureCodexOutputFile(workDir: string, sessionId: string | null) {
  const outputPath = path.join(workDir, CODEX_OUTPUT_FILE_NAME)
  try {
    const stats = await fs.promises.stat(outputPath)
    if (stats.isFile() && stats.size > 0) {
      return outputPath
    }
  } catch {
    // fall through to fallback lookup
  }

  if (!sessionId) {
    return null
  }

  const fallbackImagePath = await findNewestGeneratedImage(sessionId)
  if (!fallbackImagePath) {
    return null
  }

  await fs.promises.copyFile(fallbackImagePath, outputPath)
  return outputPath
}

function resolveCodexCommand() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    const npmCodexJsPath = path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    if (fs.existsSync(npmCodexJsPath)) {
      return {
        command: process.execPath,
        prefixArgs: [npmCodexJsPath],
      }
    }
  }

  return {
    command: 'codex',
    prefixArgs: [] as string[],
  }
}

async function runCodexExec(params: {
  workDir: string
  prompt: string
  shouldCancel?: () => boolean
  timeoutMs: number
}) {
  return await new Promise<{ stdout: string; stderr: string; lastMessage: string | null }>((resolve, reject) => {
    const resolvedCommand = resolveCodexCommand()
    const lastMessagePath = path.join(params.workDir, CODEX_LAST_MESSAGE_FILE_NAME)
    const args = [
      ...resolvedCommand.prefixArgs,
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--output-last-message',
      lastMessagePath,
      '-C',
      params.workDir,
      params.prompt,
    ]

    const child = spawn(resolvedCommand.command, args, {
      cwd: params.workDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

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
      reject(error)
    }

    const finalizeResolve = async () => {
      if (settled) {
        return
      }
      settled = true
      clearInterval(cancelInterval)
      clearTimeout(timeoutHandle)

      let lastMessage: string | null = null
      try {
        lastMessage = (await fs.promises.readFile(lastMessagePath, 'utf8')).trim() || null
      } catch {
        lastMessage = null
      }

      resolve({ stdout, stderr, lastMessage })
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
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      finalizeReject(error)
    })

    child.on('close', (code) => {
      if (cancelled) {
        finalizeReject(new Error(CODEX_CANCELLED_MESSAGE))
        return
      }

      if (timedOut) {
        finalizeReject(new Error(`Codex image generation timed out after ${params.timeoutMs}ms`))
        return
      }

      if (code !== 0) {
        const diagnostic = stderr.trim() || stdout.trim() || `Codex exited with code ${code}`
        finalizeReject(new Error(diagnostic))
        return
      }

      void finalizeResolve()
    })
  })
}

export async function cleanupCodexImageGenerationWorkDir(workDir: string) {
  await fs.promises.rm(workDir, { recursive: true, force: true })
}

export async function generateImageWithCodex(params: CodexImageGenerationParams): Promise<CodexImageGenerationResult> {
  await fs.promises.mkdir(CONAI_CODEX_JOB_ROOT, { recursive: true })
  const workDir = await fs.promises.mkdtemp(path.join(CONAI_CODEX_JOB_ROOT, 'job-'))
  const prompt = buildCodexExecutionPrompt(params)
  const timeoutMs = typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
    ? Math.max(1000, Math.round(params.timeoutMs))
    : DEFAULT_CODEX_TIMEOUT_MS

  const { stdout, stderr, lastMessage } = await runCodexExec({
    workDir,
    prompt,
    shouldCancel: params.shouldCancel,
    timeoutMs,
  })

  if (lastMessage === 'TOOL_UNAVAILABLE') {
    throw new Error('Codex built-in image generation tool is unavailable for this job')
  }

  const sessionId = parseCodexSessionId(`${stdout}\n${stderr}`)
  const outputPath = await ensureCodexOutputFile(workDir, sessionId)
  if (!outputPath) {
    throw new Error(lastMessage || 'Codex completed without producing output.png')
  }

  return {
    workDir,
    outputPath,
    sessionId,
    lastMessage,
    stdout,
    stderr,
  }
}
