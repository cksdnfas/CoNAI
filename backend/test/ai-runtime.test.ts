import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import type { AiGpuInfo } from '@conai/shared'

const temp = path.resolve(__dirname, '../../temp')
fs.mkdirSync(temp, { recursive: true })
process.env.RUNTIME_BASE_PATH = fs.mkdtempSync(path.join(temp, 'conai-ai-runtime-test-'))
process.env.AI_RUNTIME_DIR = path.join(process.env.RUNTIME_BASE_PATH, 'ai-runtime')
delete process.env.PYTHON_PATH

const gpu = (computeCapability: string, driverVersion: string): AiGpuInfo => ({ index: 0, name: 'GPU', computeCapability, driverVersion, memoryMiB: 8192 })

test('ai runtime: nvidia-smi csv parses, junk lines are skipped', async () => {
  const { parseNvidiaSmiCsv } = await import('../src/services/aiRuntime/gpuDetection')
  const gpus = parseNvidiaSmiCsv('0, NVIDIA GeForce RTX 5090, 12.0, 617.14, 32607\r\n1, Tesla P40, 6.1, 551.86, [N/A]\nNVIDIA-SMI has failed\n')
  assert.deepEqual(gpus, [
    { index: 0, name: 'NVIDIA GeForce RTX 5090', computeCapability: '12.0', driverVersion: '617.14', memoryMiB: 32607 },
    { index: 1, name: 'Tesla P40', computeCapability: '6.1', driverVersion: '551.86', memoryMiB: null },
  ])
})

test('ai runtime: build recommendation follows GPU generation and driver', async () => {
  const { recommendTorchBackend, describeTorchBackendMismatch } = await import('../src/services/aiRuntime/torchBackends')
  assert.deepEqual(recommendTorchBackend([]), { backend: 'cpu', reason: 'no-gpu', blocked: null })
  // Pascal: only the CUDA 12.6 build still has its kernels.
  assert.deepEqual(recommendTorchBackend([gpu('6.1', '590.10')]), { backend: 'cu126', reason: 'legacy-gpu', blocked: null })
  assert.deepEqual(recommendTorchBackend([gpu('6.1', '470.10')]), { backend: 'cu126', reason: 'legacy-gpu', blocked: 'driver-too-old' })
  // Ada with an R580+ driver → CUDA 13; with an older driver → 12.6.
  assert.deepEqual(recommendTorchBackend([gpu('8.9', '617.14')]), { backend: 'cu130', reason: 'current', blocked: null })
  assert.deepEqual(recommendTorchBackend([gpu('8.9', '560.94')]), { backend: 'cu126', reason: 'old-driver', blocked: null })
  // Blackwell has no CUDA 12.6 kernels: an old driver blocks instead of falling back.
  assert.deepEqual(recommendTorchBackend([gpu('12.0', '617.14')]), { backend: 'cu130', reason: 'current', blocked: null })
  assert.deepEqual(recommendTorchBackend([gpu('12.0', '566.03')]), { backend: 'cu130', reason: 'current', blocked: 'driver-too-old' })

  assert.equal(describeTorchBackendMismatch('cu126', [gpu('12.0', '617.14')]), 'gpu-not-in-build')
  assert.equal(describeTorchBackendMismatch('cu130', [gpu('6.1', '617.14')]), 'gpu-not-in-build')
  assert.equal(describeTorchBackendMismatch('cu132', [gpu('8.6', '560.00')]), 'driver-too-old')
  assert.equal(describeTorchBackendMismatch('cu130', []), 'no-gpu')
  assert.equal(describeTorchBackendMismatch('cpu', []), null)
})

test('ai runtime: settings migrate the old tagger python path and the active env wins under auto', async () => {
  const { mergeLoadedSettingsWithDefaults, getDefaultSettingsFromEnvironment } = await import('../src/services/settingsServiceStorage')
  const defaults = getDefaultSettingsFromEnvironment()
  const migrated = mergeLoadedSettingsWithDefaults({ tagger: { pythonPath: 'C:/Py/python.exe' } }, defaults)
  assert.deepEqual(migrated.aiRuntime, { pythonSource: 'auto', customPythonPath: 'C:/Py/python.exe', torchBackend: 'auto', cpuThreads: 0 })
  const cleaned = mergeLoadedSettingsWithDefaults({ aiRuntime: { pythonSource: 'weird', torchBackend: 'cu999', customPythonPath: ' py3 ', cpuThreads: -2 } }, defaults)
  assert.deepEqual(cleaned.aiRuntime, { pythonSource: 'auto', customPythonPath: 'py3', torchBackend: 'auto', cpuThreads: 0 })

  const { resolveAiPython } = await import('../src/services/aiRuntime/aiRuntimeService')
  const { setActiveAiEnvironment, venvPythonPath, aiRuntimePaths } = await import('../src/services/aiRuntime/aiRuntimeStore')
  const settings = { ...defaults, aiRuntime: { pythonSource: 'auto' as const, customPythonPath: 'py3', torchBackend: 'auto' as const, cpuThreads: 0 } }
  assert.deepEqual(resolveAiPython(settings), { command: 'py3', source: 'custom' })

  const envDir = path.join(aiRuntimePaths.envsDir(), 'cpu-test')
  const pythonPath = venvPythonPath(envDir)
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true })
  fs.writeFileSync(pythonPath, '')
  setActiveAiEnvironment({ id: 'cpu-test', backend: 'cpu', createdAt: new Date().toISOString(), pythonPath, probe: null })
  assert.deepEqual(resolveAiPython(settings), { command: pythonPath, source: 'managed' })
  assert.deepEqual(resolveAiPython({ ...settings, aiRuntime: { ...settings.aiRuntime, pythonSource: 'custom' } }), { command: 'py3', source: 'custom' })

  // A vanished env falls back to the custom path instead of spawning a missing file.
  fs.rmSync(envDir, { recursive: true, force: true })
  assert.deepEqual(resolveAiPython(settings), { command: 'py3', source: 'custom' })
})
