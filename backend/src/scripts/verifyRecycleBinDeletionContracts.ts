import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { deleteFile } from '../utils/recycleBin'

type Unlink = typeof fs.promises.unlink

function createBusyError(filePath: string): NodeJS.ErrnoException {
  const error = new Error(`EBUSY: resource busy or locked, unlink '${filePath}'`) as NodeJS.ErrnoException
  error.code = 'EBUSY'
  error.errno = -4082
  error.syscall = 'unlink'
  error.path = filePath
  return error
}

async function withOneBusyUnlink<T>(lockedPath: string, action: () => Promise<T>): Promise<{ result: T; attempts: number }> {
  const originalUnlink = fs.promises.unlink.bind(fs.promises) as Unlink
  let attempts = 0

  fs.promises.unlink = (async (target: fs.PathLike) => {
    if (path.resolve(String(target)) === path.resolve(lockedPath)) {
      attempts += 1
      if (attempts === 1) {
        throw createBusyError(lockedPath)
      }
    }

    return originalUnlink(target)
  }) as Unlink

  try {
    const result = await action()
    return { result, attempts }
  } finally {
    fs.promises.unlink = originalUnlink
  }
}

async function verifyPermanentDeleteRetriesBusyUnlink(tempDir: string) {
  const filePath = path.join(tempDir, 'busy-permanent.webp')
  await fs.promises.writeFile(filePath, 'image')

  const { attempts } = await withOneBusyUnlink(filePath, async () => deleteFile(filePath, false))

  assert.equal(attempts, 2)
  assert.equal(fs.existsSync(filePath), false)
}

async function verifyRecycleBinMoveRetriesBusySourceUnlink(tempDir: string) {
  const filePath = path.join(tempDir, 'busy-recycle.webp')
  await fs.promises.writeFile(filePath, 'image')

  const { result: recyclePath, attempts } = await withOneBusyUnlink(filePath, async () => deleteFile(filePath, true))

  assert.equal(attempts, 2)
  assert.equal(fs.existsSync(filePath), false)
  assert.equal(typeof recyclePath, 'string')
  assert.equal(fs.existsSync(recyclePath as string), true)

  await fs.promises.unlink(recyclePath as string)
}

async function main() {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'conai-recycle-bin-delete-'))

  try {
    await verifyPermanentDeleteRetriesBusyUnlink(tempDir)
    await verifyRecycleBinMoveRetriesBusySourceUnlink(tempDir)
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

main()
