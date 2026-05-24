import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const backendRoot = path.resolve(__dirname, '..', '..')
const deletionServicePath = path.join(backendRoot, 'src', 'services', 'deletionService.ts')
const wdv3DaemonPath = path.join(backendRoot, 'python', 'wdv3_tagger_daemon.py')
const kaloscopeDaemonPath = path.join(backendRoot, 'python', 'kaloscope_tagger_daemon.py')

function read(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8')
}

function verifyDeletionFailureDoesNotPretendSuccess() {
  const source = read(deletionServicePath)

  assert.equal(
    source.includes('Failed to delete original file (continuing)'),
    false,
    'deleteImage must not continue to DB deletion after an original physical file delete failure',
  )

  assert.equal(
    source.includes('물리 파일 삭제 실패해도 DB는 정리'),
    false,
    'deleteImageFile must not delete DB rows when the physical file delete failed',
  )

  assert.match(
    source,
    /catch \(error\) \{\s*console\.error\(`❌ Failed to delete physical file: \$\{original_file_path\}`,[\s\S]*?throw error;[\s\S]*?\}/,
    'deleteImageFile should rethrow physical delete failures so bulk results report failure',
  )
}

function verifyRecycleBinDirectoryIsCreatedBeforeCopy() {
  const recycleBinSource = read(path.join(backendRoot, 'src', 'utils', 'recycleBin.ts'))
  const mkdirIndex = recycleBinSource.indexOf('await fs.promises.mkdir(RECYCLE_BIN_PATH, { recursive: true })')
  const copyIndex = recycleBinSource.indexOf('await fs.promises.copyFile(filePath, recycleBinFilePath)')

  assert.ok(mkdirIndex !== -1, 'RecycleBin moves should create the recycle-bin directory when it is missing')
  assert.ok(copyIndex !== -1, 'RecycleBin moves should still copy the file into the resolved recycle-bin path')
  assert.ok(mkdirIndex < copyIndex, 'RecycleBin directory creation must happen before copying the source file')
}

function verifyPythonTaggersCloseImageHandles() {
  const wdv3Source = read(wdv3DaemonPath)
  const kaloscopeSource = read(kaloscopeDaemonPath)

  assert.match(
    wdv3Source,
    /with Image\.open\(image_path_obj\) as image:/,
    'WDv3 tagger must close PIL image file handles with a context manager',
  )
  assert.doesNotMatch(
    wdv3Source,
    /img_input:\s*Image\.Image = Image\.open\(image_path_obj\)/,
    'WDv3 tagger must not keep Image.open result outside a context manager',
  )

  assert.match(
    kaloscopeSource,
    /with Image\.open\(image_path\) as image:/,
    'Kaloscope tagger must close PIL image file handles with a context manager',
  )
  assert.doesNotMatch(
    kaloscopeSource,
    /image = Image\.open\(image_path\)\.convert\("RGB"\)/,
    'Kaloscope tagger must not keep Image.open result outside a context manager',
  )
}

verifyDeletionFailureDoesNotPretendSuccess()
verifyRecycleBinDirectoryIsCreatedBeforeCopy()
verifyPythonTaggersCloseImageHandles()

console.log('✅ Deletion lock contracts passed')
