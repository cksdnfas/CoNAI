import fs from 'fs'
import path from 'path'

const packagedExecutableNames = new Set(['conai', 'conai.exe'])

/** Detect whether the current process is running from the packaged executable. */
export function isPackagedRuntime() {
  return packagedExecutableNames.has(path.basename(process.execPath).toLowerCase())
}

/** Resolve the most appropriate .env path across dev, integrated build, portable, and SEA runs. */
export function resolveEnvPath(currentDir: string) {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env')
  }

  if (isPackagedRuntime()) {
    return path.join(path.dirname(process.execPath), '.env')
  }

  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(currentDir, '../../.env'),
    path.resolve(currentDir, '../../../.env'),
    path.resolve(currentDir, '../../../../.env'),
    path.resolve(currentDir, '../../../../../.env'),
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

/** Resolve the companion .env.example path near the resolved runtime .env file. */
export function resolveEnvExamplePath(envPath: string, currentDir: string) {
  const siblingExamplePath = path.join(path.dirname(envPath), '.env.example')
  const candidates = [
    siblingExamplePath,
    path.resolve(process.cwd(), '.env.example'),
    path.resolve(process.cwd(), '..', '.env.example'),
    path.resolve(currentDir, '../../.env.example'),
    path.resolve(currentDir, '../../../.env.example'),
    path.resolve(currentDir, '../../../../.env.example'),
    path.resolve(currentDir, '../../../../../.env.example'),
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? siblingExamplePath
}

/** Directory that should anchor relative paths declared inside the resolved .env file. */
export function resolveEnvBaseDir(currentDir: string) {
  return path.dirname(resolveEnvPath(currentDir))
}

/** Resolve an env-provided path, anchoring relative values to the .env directory instead of process.cwd(). */
export function resolveEnvConfiguredPath(value: string, currentDir: string) {
  const trimmed = value.trim()

  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed)
  }

  return path.resolve(resolveEnvBaseDir(currentDir), trimmed)
}
