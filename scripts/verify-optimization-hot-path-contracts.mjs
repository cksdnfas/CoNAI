import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (relativePath) => readFileSync(path.resolve(relativePath), 'utf8')

const downloadSource = read('backend/src/routes/images/query-file-helpers.ts')
assert.doesNotMatch(downloadSource, /AdmZip|toBuffer\(\)/, 'batch downloads must not buffer ZIP archives')
assert.match(downloadSource, /findByHashes\(limitedHashes\)/, 'batch downloads must bulk-load metadata')
assert.match(downloadSource, /findActiveByHashes\(limitedHashes\)/, 'batch downloads must bulk-load active files')
assert.match(downloadSource, /new ZipArchive/, 'batch downloads must stream a ZIP archive')

const thumbnailSource = read('backend/src/routes/images/query-list-helpers.ts')
assert.match(thumbnailSource, /MediaMetadataModel\.findByHashes\(uniqueHashes\)/, 'thumbnail batches must bulk-load metadata')
assert.match(thumbnailSource, /ImageFileModel\.findActiveByHashes\(uniqueHashes\)/, 'thumbnail batches must bulk-load files')

const groupRandomSource = read('backend/src/models/GroupImageQueries.ts')
const autoFolderRandomSource = read('backend/src/models/AutoFolderGroup.ts')
assert.doesNotMatch(groupRandomSource, /ORDER BY RANDOM\(\)/i, 'group previews must use an indexed random pivot')
assert.doesNotMatch(autoFolderRandomSource, /ORDER BY RANDOM\(\)/i, 'auto-folder previews must use an indexed random pivot')
assert.match(groupRandomSource, /ig\.id \$\{direction\} \?/, 'group previews must seek by membership id')
assert.match(autoFolderRandomSource, /afgi\.id \$\{direction\} \?/, 'auto-folder previews must seek by membership id')

const videoSource = read('backend/src/services/videoOptimizationService.ts')
assert.match(videoSource, /acquireEncoderSlot/, 'video optimization must acquire a global encoder slot')
assert.match(videoSource, /releaseEncoderSlot\(\)/, 'video optimization must release its encoder slot')

const imageSearchSource = read('backend/src/models/Image/ImageSearchModel.ts')
assert.match(imageSearchSource, /cursorDirection/, 'advanced and auto-tag searches must support stable cursors')
assert.match(imageSearchSource, /nextCursorHash/, 'search results must expose the next composite cursor')

const naiAssetStoreSource = read('backend/src/services/naiAssetStore.ts')
assert.doesNotMatch(naiAssetStoreSource, /readdirSync|readFileSync|writeFileSync|existsSync/, 'NAI asset requests must not block on synchronous filesystem APIs')
assert.match(naiAssetStoreSource, /getVibeAssetFileIndex/, 'NAI vibe assets must use an in-memory path index')
assert.match(naiAssetStoreSource, /getCharacterAssetMetadataIndex/, 'NAI character assets must use an in-memory path index')

const i18nSource = read('frontend/src/i18n/index.tsx')
assert.doesNotMatch(i18nSource, /featureLocaleCatalog/, 'i18n bootstrap must not eagerly import every feature catalog')
assert.match(i18nSource, /registerTranslationCatalog/, 'lazy routes must be able to register feature catalogs')

const wallpaperSource = read('frontend/src/features/wallpaper/wallpaper-widget-data.ts')
assert.match(wallpaperSource, /WALLPAPER_BROWSE_CONTENT_QUERY_KEY/, 'wallpaper widgets must share one browse-content query key')
assert.doesNotMatch(wallpaperSource, /queryKey: \['wallpaper-widget', scope, 'browse-content'/, 'wallpaper widgets must not split identical browse payloads by scope')

console.log('Optimization hot-path contracts verified')
