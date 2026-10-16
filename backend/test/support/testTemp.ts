/**
 * Import this FIRST in every test file. It points this process's temp directory (TEMP/TMP/TMPDIR, which
 * `os.tmpdir()` reads on each call) at its own folder under `<tmp>/conai-tests`, so every scratch folder the test or
 * the code under test creates lands there, and a detached watcher deletes that folder once this process has exited.
 * Deleting from inside the process does not work on Windows: SQLite still holds its files at `exit`.
 * Folders whose process is gone but were not deleted (watcher killed too) are swept by the next test that starts.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MARKER = 'CONAI_TEST_TEMP_DIR'
const STALE_MS = 24 * 60 * 60 * 1000

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// A process started by a test inherits the folder; only the test process itself sets one up.
if (!process.env[MARKER]) {
  const base = path.join(os.tmpdir(), 'conai-tests')
  fs.mkdirSync(base, { recursive: true })

  for (const name of fs.readdirSync(base)) {
    const folder = path.join(base, name)
    const pid = Number(name.split('-')[0])
    try {
      const stale = Date.now() - fs.statSync(folder).mtimeMs > STALE_MS
      if (!stale && Number.isInteger(pid) && pid > 0 && isAlive(pid)) continue
      fs.rmSync(folder, { recursive: true, force: true })
    } catch {
      // Another test is sweeping it, or a file is still held; the next run tries again.
    }
  }

  const dir = fs.mkdtempSync(path.join(base, `${process.pid}-`))
  process.env.TEMP = dir
  process.env.TMP = dir
  process.env.TMPDIR = dir
  process.env[MARKER] = dir

  const watcher = `
    const fs = require('fs')
    const [pid, dir] = process.argv.slice(1)
    const gone = () => { try { process.kill(Number(pid), 0); return false } catch (error) { return error.code !== 'EPERM' } }
    const started = Date.now()
    const timer = setInterval(() => {
      if (!gone() && Date.now() - started < ${STALE_MS}) return
      clearInterval(timer)
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch {}
    }, 500)
  `
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  delete env.NODE_TEST_CONTEXT
  spawn(process.execPath, ['-e', watcher, String(process.pid), dir], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref()
}
