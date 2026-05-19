import { doesNotMatch, ok, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function sliceRequiredSource(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start)
  const endIndex = sourceText.indexOf(end, startIndex)

  ok(startIndex >= 0, `missing source marker: ${start}`)
  ok(endIndex > startIndex, `missing source marker: ${end}`)

  return sourceText.slice(startIndex, endIndex)
}

function verifySingleImageDownloadUsesBlobFlow() {
  const apiImagesSource = source('src/lib/api-images.ts')
  const singleDownloadSource = sliceRequiredSource(
    apiImagesSource,
    'async function downloadSingleImage',
    'export async function downloadImageSelection',
  )

  doesNotMatch(
    singleDownloadSource,
    /triggerBrowserDownload\(/,
    'single image downloads should not rely on direct hidden-anchor navigation; it can abort silently in Chromium download flows',
  )
  match(
    singleDownloadSource,
    /await fetch\(buildImageDownloadUrl\(compositeHash, type\), \{[\s\S]*?method: 'GET',[\s\S]*?credentials: 'include',[\s\S]*?Accept: type === 'thumbnail' \? 'image\/webp' : 'application\/octet-stream',[\s\S]*?\}\)/,
    'single image downloads should fetch the attachment with credentials and an explicit Accept header',
  )
  match(
    singleDownloadSource,
    /const blob = await response\.blob\(\)/,
    'single image downloads should convert the response into a blob before triggering the browser save UI',
  )
  match(
    singleDownloadSource,
    /getDownloadFileName\(response\.headers\.get\('Content-Disposition'\), fallbackFileName\)/,
    'single image downloads should preserve backend attachment filenames when Content-Disposition is available',
  )
  match(
    singleDownloadSource,
    /triggerBlobDownload\(blob, fileName\)/,
    'single image downloads should trigger the save UI from a blob URL',
  )
  match(
    apiImagesSource,
    /function getSingleImageDownloadFallbackName\(compositeHash: string, type: ImageDownloadType, contentType: string \| null\)/,
    'single image downloads should keep content-type based fallback filenames',
  )
}

function verifyBatchImageDownloadUsesServerArchiveName() {
  const apiImagesSource = source('src/lib/api-images.ts')
  const batchDownloadSource = sliceRequiredSource(
    apiImagesSource,
    'export async function downloadImageSelection',
    'export interface UploadBatchResultItem',
  )

  match(
    batchDownloadSource,
    /const blob = await readDownloadBlob\(response, `Batch download failed: \$\{response\.status\}`\)/,
    'batch image downloads should reuse the shared blob/error reader so backend error text is preserved',
  )
  match(
    batchDownloadSource,
    /const fallbackFileName = `conai-images-\$\{type\}-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 19\)\.replace\(\/\[T:\]\/g, '-'\)\}\.zip`/,
    'batch image downloads should keep the timestamped fallback zip name',
  )
  match(
    batchDownloadSource,
    /getDownloadFileName\(response\.headers\.get\('Content-Disposition'\), fallbackFileName\)/,
    'batch image downloads should preserve backend archive filenames when Content-Disposition is available',
  )
  match(
    batchDownloadSource,
    /triggerBlobDownload\(blob, fileName\)/,
    'batch image downloads should trigger the save UI with the resolved archive filename',
  )
}

verifySingleImageDownloadUsesBlobFlow()
verifyBatchImageDownloadUsesServerArchiveName()
console.log('Image download contracts verified.')
