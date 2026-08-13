import { match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const runnerSource = readFileSync(resolve(process.cwd(), 'scripts/run-built-if-needed.js'), 'utf8')

const requiredBuildInputs = [
  "path.join(ROOT_DIR, '.env')",
  "path.join(ROOT_DIR, '.env.example')",
  "path.join(ROOT_DIR, '.env.local')",
  "path.join(ROOT_DIR, '.env.production')",
  "path.join(ROOT_DIR, '.env.production.local')",
  "path.join(ROOT_DIR, 'scripts', 'build-integrated.js')",
  "path.join(ROOT_DIR, 'scripts', 'ensure-workspace-dependencies.js')",
  "path.join(ROOT_DIR, 'frontend', 'public')",
  "path.join(ROOT_DIR, 'frontend', 'scripts')",
  "path.join(ROOT_DIR, 'frontend', 'tsconfig.app.json')",
  "path.join(ROOT_DIR, 'frontend', 'tsconfig.json')",
  "path.join(ROOT_DIR, 'frontend', 'tsconfig.node.json')",
  "path.join(ROOT_DIR, 'frontend', 'vite.config.ts')",
  "path.join(ROOT_DIR, 'backend', 'tsconfig.json')",
  "path.join(ROOT_DIR, 'shared', 'tsconfig.json')",
]

for (const buildInput of requiredBuildInputs) {
  match(runnerSource, new RegExp(buildInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `freshness check must track ${buildInput}`)
}

console.log('Build freshness contracts verified.')
