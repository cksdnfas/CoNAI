/**
 * Import this FIRST in a test that loads runtime modules with static imports. ES imports are hoisted above the test
 * file's own statements, so a `process.env.RUNTIME_BASE_PATH = …` written in the test itself runs only after the src
 * modules have already resolved their data root.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-test-'))
process.env.RUNTIME_BASE_PATH = scratchDir
