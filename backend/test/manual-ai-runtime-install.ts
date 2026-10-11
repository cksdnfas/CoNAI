// Manual check, not part of any suite: installs a real environment into a scratch folder.
// Usage: AI_RUNTIME_DIR=<dir> RUNTIME_BASE_PATH=<dir> npx tsx test/manual-ai-runtime-install.ts <cpu|cu130|...>
async function main() {
  const backend = process.argv[2] as any
  const { startAiRuntimeInstall, getAiRuntimeStatus } = await import('../src/services/aiRuntime/aiRuntimeService')
  const before = await getAiRuntimeStatus({ refreshGpus: true })
  console.log('gpus', JSON.stringify(before.gpus), 'recommendation', JSON.stringify(before.recommendation))
  const started = Date.now()
  await startAiRuntimeInstall(backend)
  let printed = 0
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const status = await getAiRuntimeStatus()
    const lines = status.install.log
    for (const line of lines.slice(printed)) console.log('  |', line)
    printed = lines.length
    if (status.install.status !== 'running') {
      console.log(`status=${status.install.status} step=${status.install.step} error=${status.install.error} downloaded=${(status.install.downloadedBytes / 1e9).toFixed(2)}GB in ${((Date.now() - started) / 1000).toFixed(0)}s`)
      console.log('active', JSON.stringify(status.active, null, 1))
      console.log('resolved', JSON.stringify(status.resolvedPython))
      break
    }
  }
}
void main()
