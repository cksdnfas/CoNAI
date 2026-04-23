import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
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

const SUPPORTED_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp'])
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function resolveOutputFormat(value: string | undefined) {
  if (!value) {
    return 'png' as const
  }

  return SUPPORTED_OUTPUT_FORMATS.has(value) ? value as 'png' | 'jpeg' | 'webp' : 'png'
}

function resolveOutputExtension(format: 'png' | 'jpeg' | 'webp') {
  return format === 'jpeg' ? 'jpg' : format
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
    })

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.once('error', (error) => {
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

    child.once('close', (code) => {
      const rawOutput = `${stdout}\n${stderr}`.trim()
      const normalized = rawOutput.toLowerCase()
      const authenticated = normalized.includes('logged in')
      const authModeMatch = rawOutput.match(/logged in using\s+(.+)/i)
      const installed = code === 0 || rawOutput.length > 0
      const message = authenticated
        ? (authModeMatch?.[0]?.trim() || rawOutput || 'Logged in')
        : (rawOutput || `Codex login status exited with code ${code ?? 'unknown'}`)

      resolve({
        installed,
        authenticated,
        available: installed && authenticated,
        authMode: authModeMatch?.[1]?.trim() ?? null,
        command: resolvedCommand.command,
        rawOutput,
        message,
        exitCode: code,
      })
    })
  })
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

  args.push(prompt)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolvedCommand.command, args, {
      cwd: jobDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    })

    const stdoutStream = fs.createWriteStream(stdoutPath)
    const stderrStream = fs.createWriteStream(stderrPath)
    let settled = false

    const finalize = (error?: Error) => {
      if (settled) {
        return
      }
      settled = true
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

    child.once('close', async (code) => {
      if (code === 0) {
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

      finalize(new Error([
        `codex exec failed with exit code ${code ?? 'unknown'}`,
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
  if (typeof payload.prompt !== 'string' || payload.prompt.trim().length === 0) {
    throw new Error('Codex queue payload requires a non-empty prompt')
  }

  const requestedCount = Math.max(1, Math.min(payload.count ?? 1, 4))
  const outputFormat = resolveOutputFormat(payload.output_format)
  const outputExtension = resolveOutputExtension(outputFormat)
  const jobRoot = path.join(runtimePaths.tempDir, 'codex-jobs')
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

  const requestedFileNames = Array.from({ length: requestedCount }, (_, index) => `codex-output-${String(index + 1).padStart(2, '0')}.${outputExtension}`)
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
