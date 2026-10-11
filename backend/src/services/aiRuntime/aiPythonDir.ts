import fs from 'fs'
import path from 'path'

let cached: string | null = null

/** Folder holding the Python scripts and requirements, across dev, compiled, bundled and portable layouts. */
export function aiPythonDir(): string {
  if (cached) {
    return cached
  }
  const candidates = [
    // Bundle build: python next to the bundle
    path.join(__dirname, 'python'),
    // Development: backend/src/services/aiRuntime -> backend/python
    path.join(__dirname, '..', '..', '..', 'python'),
    // Compiled integrated build: backend/dist/backend/src/services/aiRuntime -> backend/python
    path.join(__dirname, '..', '..', '..', '..', '..', 'python'),
    // Compiled build with bundled runtime assets: backend/dist/backend/src/services/aiRuntime -> backend/dist/python
    path.join(__dirname, '..', '..', '..', '..', 'python'),
    // Portable build: dist/services/aiRuntime -> app/python
    path.join(__dirname, '..', '..', 'python'),
    path.join(process.cwd(), 'app', 'python'),
  ]
  cached = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'ai_runtime_probe.py'))) ?? candidates[1]
  return cached
}
