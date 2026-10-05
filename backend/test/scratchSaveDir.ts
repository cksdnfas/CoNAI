import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Imported before anything that reads runtimePaths: file stores under test write to a scratch folder. */
process.env.RUNTIME_SAVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-test-save-'))
