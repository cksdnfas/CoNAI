import fs from 'fs'
import path from 'path'
import type { AiRuntimeProbe } from '@conai/shared'
import { runtimePaths } from '../../config/runtimePaths'
import { settingsService } from '../settingsService'
import { VideoFrameExtractor } from '../videoFrameExtractor'
import { TagMergeService } from '../tagMergeService'
import type { TaggerResult } from '../taggerDaemon'
import { KALOSCOPE_MODEL, type KaloscopeResult } from '../autoTagsComposeService'
import { vectorStore } from '../vectors/vectorStore'
import { probeAiPython, resolveAiPython } from '../aiRuntime/aiRuntimeService'
import { AiWorkerClient, defaultAiThreads, type AiWorkerPriority } from './aiWorkerClient'

export { KALOSCOPE_MODEL }
export const KALOSCOPE_REPO = 'heathcliff01/Kaloscope3.0-preview'
export const KALOSCOPE_FILE = 'v1-artist-classifier/model.safetensors'
/** Space + model key of the 256-d Kaloscope style vectors (one per media, by composite hash). */
export const MEDIA_STYLE_SPACE = 'media-style'
export const MEDIA_STYLE_MODEL_KEY = 'kaloscope-3.0-preview@5e4bfa2'

const LAMA_IDLE_MINUTES = 5

type IdlePolicy = { keepModelLoaded: boolean; autoUnloadMinutes: number }

function idleMinutes(policy: IdlePolicy) {
  return policy.keepModelLoaded ? null : Math.max(1, policy.autoUnloadMinutes || 1)
}

export function aiThreads() {
  const configured = settingsService.loadSettings().aiRuntime.cpuThreads
  return configured > 0 ? configured : defaultAiThreads()
}

/** The worker process for image models (WD / PixAI tagger, Kaloscope). */
export const visionWorker = new AiWorkerClient({
  label: 'AiVisionWorker',
  env: () => ({ CONAI_AI_THREADS: String(aiThreads()), CONAI_AI_ROLE: 'vision' }),
  idleMinutes: (model) => {
    // LaMa (image editor AI erase) runs in bursts while someone edits; it has no setting of its own.
    if (model === 'lama') return LAMA_IDLE_MINUTES
    const settings = settingsService.loadSettings()
    return idleMinutes(model === 'kaloscope' ? settings.kaloscope : settings.tagger)
  },
})

export type VisionTasks = {
  tagger?: boolean
  kaloscope?: boolean | { topk?: number }
}

export type KaloscopeVisionResult = KaloscopeResult & { style?: number[] }

export type VisionResult = {
  tagger?: TaggerResult
  kaloscope?: KaloscopeVisionResult
}

type AnalyzeReply = {
  wd?: TaggerResult[]
  kaloscope?: KaloscopeVisionResult
  devices?: Record<string, string>
}

function taggerOptions() {
  const tagger = settingsService.loadSettings().tagger
  return { variant: tagger.model, device: tagger.device, general: tagger.generalThreshold, character: tagger.characterThreshold }
}

function kaloscopeOptions(topk?: number) {
  const kaloscope = settingsService.loadSettings().kaloscope
  return { device: kaloscope.device, topk: topk ?? kaloscope.topK, style: kaloscope.styleVectors !== false }
}

function failure(error: unknown, errorType = 'WorkerError') {
  const message = error instanceof Error ? error.message : String(error)
  const type = (error as { errorType?: string })?.errorType ?? errorType
  return { success: false as const, error: message, error_type: type }
}

/**
 * Run the tagger and/or Kaloscope over one image or a video in a single worker request: the file (or each of the
 * video's frames, extracted once) is decoded once and shared by both models. With `compositeHash`, the Kaloscope
 * style vector is stored for that media.
 */
export async function analyzeMedia(
  filePath: string,
  isVideo: boolean,
  tasks: VisionTasks,
  options: { priority?: AiWorkerPriority; compositeHash?: string } = {},
): Promise<VisionResult> {
  if (!tasks.tagger && !tasks.kaloscope) {
    return {}
  }
  const precondition = !fs.existsSync(filePath)
    ? { success: false as const, error: `File not found: ${filePath}`, error_type: 'FileNotFound' }
    : await checkAiDependencies().then((dependencies) =>
      dependencies.available ? null : { success: false as const, error: dependencies.message, error_type: 'MissingDependency' })
  if (precondition) {
    return { ...(tasks.tagger && { tagger: precondition }), ...(tasks.kaloscope && { kaloscope: precondition }) }
  }
  let frames: string[] = []
  let reply: AnalyzeReply
  try {
    frames = isVideo ? await VideoFrameExtractor.extractFramesForTagging(filePath) : [filePath]
    const payload: Record<string, unknown> = { images: frames }
    if (tasks.tagger) payload.wd = taggerOptions()
    if (tasks.kaloscope) payload.kaloscope = kaloscopeOptions(typeof tasks.kaloscope === 'object' ? tasks.kaloscope.topk : undefined)
    reply = await visionWorker.request<AnalyzeReply>('analyze', payload, { priority: options.priority })
  } catch (error) {
    return {
      ...(tasks.tagger && { tagger: failure(error) }),
      ...(tasks.kaloscope && { kaloscope: failure(error) }),
    }
  } finally {
    if (isVideo && frames.length > 0) {
      await VideoFrameExtractor.cleanupTempFrames(frames).catch(() => undefined)
    }
  }

  for (const model of ['wd', 'kaloscope'] as const) {
    if (reply.devices?.[model]) visionWorker.touch(model, reply.devices[model])
  }

  const result: VisionResult = {}
  if (tasks.tagger) {
    const frameResults = reply.wd ?? [failure('tagger returned nothing')]
    result.tagger = isVideo ? TagMergeService.mergeVideoTagResults(frameResults) : frameResults[0]
  }
  if (tasks.kaloscope) {
    const kaloscope = reply.kaloscope ?? failure('Kaloscope returned nothing')
    result.kaloscope = kaloscope.success ? { ...kaloscope, tagged_at: new Date().toISOString() } : kaloscope
    if (options.compositeHash && kaloscope.success && kaloscope.style?.length) {
      saveMediaStyleVector(options.compositeHash, kaloscope.style)
    }
  }
  return result
}

export function saveMediaStyleVector(compositeHash: string, style: number[]) {
  try {
    vectorStore.replace(MEDIA_STYLE_SPACE, compositeHash, MEDIA_STYLE_MODEL_KEY, [{ vector: style }])
  } catch (error) {
    console.warn('[AiVision] Failed to store style vector:', error instanceof Error ? error.message : error)
  }
}

let probeCache: { python: string; probe: AiRuntimeProbe; at: number } | null = null

/** The AI Python's probe (torch, CUDA, packages), cached for a minute. */
export async function aiRuntimeProbe(): Promise<{ python: string; probe: AiRuntimeProbe }> {
  const python = resolveAiPython().command
  if (!probeCache || probeCache.python !== python || Date.now() - probeCache.at > 60_000) {
    probeCache = { python, probe: await probeAiPython(python), at: Date.now() }
  }
  return { python, probe: probeCache.probe }
}

/** Whether torch here can run on this GPU (CUDA build, the GPU's architecture compiled in, a test op passed). */
export async function aiGpuReady() {
  const { probe } = await aiRuntimeProbe()
  return Boolean(probe.torch && probe.cudaAvailable && probe.gpuSupported !== false && probe.gpuComputeOk !== false)
}

/** Whether the AI Python can run the worker (cached probe, a minute); `packages` narrows the check to what one feature imports. */
export async function checkAiDependencies(packages?: readonly string[]): Promise<{ available: boolean; message: string; missingPackages: string[]; python: string }> {
  const { python, probe } = await aiRuntimeProbe()
  const missingPackages = Object.entries(probe.packages)
    .filter(([name, version]) => !version && (!packages || packages.includes(name)))
    .map(([name]) => name)
  if (probe.torch && missingPackages.length === 0) {
    return { available: true, message: 'AI runtime ready', missingPackages, python }
  }
  return {
    available: false,
    message: probe.python
      ? `AI 런타임에 필요한 패키지가 없어 (${missingPackages.join(', ') || 'torch'}). 설정 › 자동 › AI 런타임에서 설치해줘.`
      : `Python을 실행할 수 없어 (${python}). 설정 › 자동 › AI 런타임에서 설치해줘.`,
    missingPackages,
    python,
  }
}

export function isHubModelCached(repo: string, file: string) {
  const snapshots = path.join(runtimePaths.modelsDir, `models--${repo.replace('/', '--')}`, 'snapshots')
  try {
    return fs.readdirSync(snapshots).some((snapshot) => fs.existsSync(path.join(snapshots, snapshot, file)))
  } catch {
    return false
  }
}
