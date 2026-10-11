import { execFile } from 'child_process'
import type { AiGpuInfo } from '@conai/shared'

const NVIDIA_SMI_TIMEOUT_MS = 10_000
const CACHE_MS = 60_000

export type GpuDetectionResult = { gpus: AiGpuInfo[]; error: string | null }

let cache: { result: GpuDetectionResult; at: number } | null = null

/** Rows of `nvidia-smi --query-gpu=index,name,compute_cap,driver_version,memory.total --format=csv,noheader,nounits`. */
export function parseNvidiaSmiCsv(output: string): AiGpuInfo[] {
  const gpus: AiGpuInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    const cells = line.split(',').map((cell) => cell.trim())
    if (cells.length < 4 || !/^\d+$/.test(cells[0])) {
      continue
    }
    const [index, name, computeCapability, driverVersion, memory] = cells
    const memoryMiB = Number.parseInt(memory ?? '', 10)
    gpus.push({
      index: Number(index),
      name,
      computeCapability,
      driverVersion,
      memoryMiB: Number.isFinite(memoryMiB) ? memoryMiB : null,
    })
  }
  return gpus
}

function runNvidiaSmi(): Promise<GpuDetectionResult> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=index,name,compute_cap,driver_version,memory.total', '--format=csv,noheader,nounits'],
      { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          // ENOENT = no NVIDIA driver on PATH: a CPU machine, not an error worth showing.
          const code = (error as NodeJS.ErrnoException).code
          resolve({ gpus: [], error: code === 'ENOENT' ? null : (`${stderr}`.trim() || error.message) })
          return
        }
        resolve({ gpus: parseNvidiaSmiCsv(`${stdout}`), error: null })
      },
    )
  })
}

/** NVIDIA GPUs on this machine (inside Docker: the ones passed through). Cached for a minute. */
export async function detectGpus(options?: { refresh?: boolean }): Promise<GpuDetectionResult> {
  if (!options?.refresh && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.result
  }
  const result = await runNvidiaSmi()
  cache = { result, at: Date.now() }
  return result
}
