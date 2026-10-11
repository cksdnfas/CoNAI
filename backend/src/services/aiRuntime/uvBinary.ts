import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { aiRuntimePaths } from './aiRuntimeStore'

/** Pinned uv release; bump deliberately (the installer flags it uses: `--torch-backend`, managed Python). */
export const UV_VERSION = '0.12.18'
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000

function uvAssetName(): string | null {
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : null
  if (!arch) {
    return null
  }
  switch (process.platform) {
    case 'win32':
      return arch === 'x86_64' ? 'uv-x86_64-pc-windows-msvc.zip' : null
    case 'linux':
      return `uv-${arch}-unknown-linux-gnu.tar.gz`
    case 'darwin':
      return `uv-${arch}-apple-darwin.tar.gz`
    default:
      return null
  }
}

export function isUvSupported() {
  return Boolean(process.env.CONAI_UV_PATH?.trim() || uvAssetName())
}

function uvExecutableName() {
  return process.platform === 'win32' ? 'uv.exe' : 'uv'
}

function findFile(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === name) {
      return full
    }
    if (entry.isDirectory()) {
      const nested = findFile(full, name)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function readVersion(uvPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(uvPath, ['--version'], { timeout: 15_000, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : `${stdout}`.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null)
    })
  })
}

async function download(url: string, target: string) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok || !response.body) {
    throw new Error(`uv 다운로드 실패 (${response.status}): ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body as any), fs.createWriteStream(target))
}

/**
 * Windows: System32 bsdtar reads .zip (a Git/MSYS `tar` earlier on PATH reads `C:` as a remote host), else
 * PowerShell's Expand-Archive. Elsewhere: tar for the .tar.gz builds.
 */
function extractCommand(archive: string, targetDir: string): [string, string[]] {
  if (process.platform === 'win32') {
    const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    if (fs.existsSync(systemTar)) {
      return [systemTar, ['-xf', archive, '-C', targetDir]]
    }
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(targetDir)} -Force`]]
  }
  return ['tar', ['-xf', archive, '-C', targetDir]]
}

function extract(archive: string, targetDir: string): Promise<void> {
  const [command, args] = extractCommand(archive, targetDir)
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 60_000, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`uv 압축 해제 실패: ${`${stderr}`.trim() || error.message}`))
        return
      }
      resolve()
    })
  })
}

/**
 * Path to the uv executable, downloading the pinned release (checked against its published SHA-256) the first time.
 * `CONAI_UV_PATH` points at an existing uv instead.
 */
export async function ensureUv(log: (line: string) => void): Promise<string> {
  const override = process.env.CONAI_UV_PATH?.trim()
  if (override) {
    return override
  }

  const uvDir = aiRuntimePaths.uvDir()
  const installed = path.join(uvDir, UV_VERSION, uvExecutableName())
  if (fs.existsSync(installed) && (await readVersion(installed)) === UV_VERSION) {
    return installed
  }

  const asset = uvAssetName()
  if (!asset) {
    throw new Error(`이 플랫폼(${process.platform}/${process.arch})용 uv 빌드가 없어.`)
  }

  const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`
  const workDir = path.join(uvDir, `.download-${process.pid}-${Date.now()}`)
  fs.mkdirSync(workDir, { recursive: true })
  try {
    log(`uv ${UV_VERSION} 받는 중 (${asset})`)
    const archive = path.join(workDir, asset)
    await download(base, archive)
    const checksumFile = path.join(workDir, `${asset}.sha256`)
    await download(`${base}.sha256`, checksumFile)
    const expected = fs.readFileSync(checksumFile, 'utf-8').trim().split(/\s+/)[0]?.toLowerCase()
    const actual = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    if (!expected || expected !== actual) {
      throw new Error('uv 체크섬이 맞지 않아. 받은 파일을 버렸어.')
    }

    const extractDir = path.join(workDir, 'x')
    fs.mkdirSync(extractDir)
    await extract(archive, extractDir)
    const extracted = findFile(extractDir, uvExecutableName())
    if (!extracted) {
      throw new Error('압축 파일 안에서 uv 실행 파일을 못 찾았어.')
    }
    fs.mkdirSync(path.dirname(installed), { recursive: true })
    fs.copyFileSync(extracted, installed)
    if (process.platform !== 'win32') {
      fs.chmodSync(installed, 0o755)
    }
    log(`uv ${UV_VERSION} 준비됨`)
    return installed
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}
