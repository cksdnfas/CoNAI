import type { AiGpuInfo, AiRuntimeRecommendation, AiTorchBackend, AiTorchBackendPreference } from '@conai/shared'

/** torch/torchvision pinned for every build; 2.14 is the last release that still ships cu126 (Maxwell–Volta). */
export const TORCH_VERSION = '2.14.1'
export const TORCHVISION_VERSION = '0.29.1'

/** CUDA 13 wheels need an R580+ driver; CUDA 12.x wheels run on R525+ through minor-version compatibility. */
const CUDA13_MIN_DRIVER_MAJOR = 580
const CUDA12_MIN_DRIVER_MAJOR = 525

type TorchBackendSpec = {
  /** Lowest compute capability with kernels in the build (×10, e.g. 75 = 7.5). */
  minCapability: number
  /** Highest compute capability with kernels in the build (×10), or null when newer cards run too. */
  maxCapability: number | null
  minDriverMajor: number | null
}

export const TORCH_BACKENDS: Record<AiTorchBackend, TorchBackendSpec> = {
  cpu: { minCapability: 0, maxCapability: null, minDriverMajor: null },
  // cu126 builds stop at Hopper (9.0): Blackwell needs CUDA 12.8+.
  cu126: { minCapability: 50, maxCapability: 90, minDriverMajor: CUDA12_MIN_DRIVER_MAJOR },
  cu130: { minCapability: 75, maxCapability: null, minDriverMajor: CUDA13_MIN_DRIVER_MAJOR },
  cu132: { minCapability: 75, maxCapability: null, minDriverMajor: CUDA13_MIN_DRIVER_MAJOR },
}

export function isAiTorchBackend(value: unknown): value is AiTorchBackend {
  return typeof value === 'string' && value in TORCH_BACKENDS
}

/** "12.0" → 120; null when unparseable. */
export function capabilityToNumber(capability: string): number | null {
  const match = capability.trim().match(/^(\d+)\.(\d+)$/)
  return match ? Number(match[1]) * 10 + Number(match[2]) : null
}

/** "617.14" → 617; null when unparseable. */
export function driverMajor(driverVersion: string): number | null {
  const match = driverVersion.trim().match(/^(\d+)/)
  return match ? Number(match[1]) : null
}

/**
 * Pick the build for the first GPU (the one CUDA uses by default):
 * no GPU → cpu; cc < 7.5 → cu126; driver ≥ R580 → cu130; otherwise cu126, except Blackwell (cc ≥ 10), which no
 * CUDA 12.6 build covers — then cu130 stays the pick but is blocked until the driver is updated.
 */
export function recommendTorchBackend(gpus: AiGpuInfo[]): AiRuntimeRecommendation {
  const gpu = gpus[0]
  const capability = gpu ? capabilityToNumber(gpu.computeCapability) : null
  if (!gpu || capability === null) {
    return { backend: 'cpu', reason: 'no-gpu', blocked: null }
  }

  const driver = driverMajor(gpu.driverVersion) ?? 0
  if (capability < TORCH_BACKENDS.cu130.minCapability) {
    return { backend: 'cu126', reason: 'legacy-gpu', blocked: driver < CUDA12_MIN_DRIVER_MAJOR ? 'driver-too-old' : null }
  }
  if (driver >= CUDA13_MIN_DRIVER_MAJOR) {
    return { backend: 'cu130', reason: 'current', blocked: null }
  }
  if (capability > (TORCH_BACKENDS.cu126.maxCapability ?? Infinity)) {
    return { backend: 'cu130', reason: 'current', blocked: 'driver-too-old' }
  }
  return { backend: 'cu126', reason: 'old-driver', blocked: driver < CUDA12_MIN_DRIVER_MAJOR ? 'driver-too-old' : null }
}

export function resolveTorchBackend(preference: AiTorchBackendPreference, gpus: AiGpuInfo[]): AiTorchBackend {
  return preference === 'auto' ? recommendTorchBackend(gpus).backend : preference
}

/** Why a chosen CUDA build will not run on the first GPU, or null when it should. */
export function describeTorchBackendMismatch(backend: AiTorchBackend, gpus: AiGpuInfo[]): 'no-gpu' | 'gpu-not-in-build' | 'driver-too-old' | null {
  if (backend === 'cpu') {
    return null
  }
  const gpu = gpus[0]
  const capability = gpu ? capabilityToNumber(gpu.computeCapability) : null
  if (!gpu || capability === null) {
    return 'no-gpu'
  }
  const spec = TORCH_BACKENDS[backend]
  if (capability < spec.minCapability || (spec.maxCapability !== null && capability > spec.maxCapability)) {
    return 'gpu-not-in-build'
  }
  if (spec.minDriverMajor !== null && (driverMajor(gpu.driverVersion) ?? 0) < spec.minDriverMajor) {
    return 'driver-too-old'
  }
  return null
}
