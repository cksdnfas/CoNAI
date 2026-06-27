import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

process.env.NODE_ENV = 'production'

const require = createRequire(import.meta.url)

function runBin(binPath, args) {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    console.error(result.error)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const viteRoot = path.resolve(path.dirname(require.resolve('vite')), '..', '..')

runBin(require.resolve('typescript/bin/tsc'), ['-b'])
runBin(path.join(viteRoot, 'bin', 'vite.js'), ['build'])
