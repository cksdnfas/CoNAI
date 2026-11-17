import { spawn } from 'node:child_process'

// Child processes get none of CoNAI's environment (secrets, configuration): only what Node, npm, Chromium and FFmpeg need.
const PASSED_ENV = ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'LANG', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'HYPERFRAMES_FFMPEG_PATH', 'HYPERFRAMES_FFPROBE_PATH']
export const hostEnv = extra => ({ ...Object.fromEntries(PASSED_ENV.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]])), ...extra })

/** Runs a command to completion and returns the tail of its output. Abort or the deadline kills its whole process tree. */
export function run(command, args, { cwd, env, signal, timeoutMs, onLine, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    // Its own process group on POSIX, so Chromium/FFmpeg grandchildren die with it. The stdin pipe is never written:
    // it closes when this server module stops, which the render script takes as its signal to exit.
    const child = spawn(command, args, { cwd, env, shell, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.on('error', () => {})
    let tail = '', timedOut = false, grace = null
    const force = () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
      else try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }
    // On POSIX Puppeteer puts Chromium in its own process group, out of reach of the group kill. Closing stdin makes
    // the render script exit by itself, which runs Puppeteer's exit hook; the group kill follows for whatever is left.
    const kill = () => {
      if (process.platform === 'win32') return force()
      child.stdin.end()
      grace ??= setTimeout(force, 3000)
    }
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; kill() }, timeoutMs) : null
    signal?.addEventListener('abort', kill, { once: true })
    const emit = line => { if (line) { tail = `${tail}${line}\n`.slice(-6000); onLine?.(line) } }
    const flushes = [child.stdout, child.stderr].map(stream => {
      let partial = ''
      stream.setEncoding('utf8')
      stream.on('data', chunk => {
        partial += chunk
        let newline
        while ((newline = partial.indexOf('\n')) >= 0) { emit(partial.slice(0, newline).trim()); partial = partial.slice(newline + 1) }
        if (partial.length > 65536) partial = partial.slice(-65536)
      })
      return () => emit(partial.trim())
    })
    const settle = error => { clearTimeout(timer); clearTimeout(grace); signal?.removeEventListener('abort', kill); if (error) reject(error); else resolve(tail) }
    child.on('error', settle)
    child.on('close', code => {
      for (const flush of flushes) flush()
      if (signal?.aborted) settle(signal.reason ?? new Error('취소됐어.'))
      else if (timedOut) settle(new Error('실행 시간 상한을 넘겨서 중단했어.'))
      else settle(code === 0 ? null : new Error(tail.trim() || `종료 코드: ${code}`))
    })
  })
}
