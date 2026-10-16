import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

// Every test's scratch folders go under its own temp folder that is deleted after it exits (support/testTemp).
// A test file that skips the import leaves its folders in the system temp directory for good.
test('every test file imports support/testTemp first', () => {
  const dir = __dirname
  const missing = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.test.ts'))
    .filter((name) => !/^﻿?import '\.\/support\/testTemp'\r?\n/.test(fs.readFileSync(path.join(dir, name), 'utf8')))
  assert.deepEqual(missing, [], 'add `import \'./support/testTemp\'` as the first line')
})
