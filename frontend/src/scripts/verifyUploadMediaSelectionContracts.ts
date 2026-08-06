import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mediaDropSurfaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/media/media-file-drop-surface.tsx'),
  'utf8',
)
const localFilePreviewsSource = readFileSync(
  resolve(process.cwd(), 'src/features/upload/use-local-file-previews.ts'),
  'utf8',
)
const uploadPageSectionsSource = readFileSync(
  resolve(process.cwd(), 'src/features/upload/components/upload-page-sections.tsx'),
  'utf8',
)
const uploadPageSource = readFileSync(
  resolve(process.cwd(), 'src/features/upload/upload-page.tsx'),
  'utf8',
)
const imageAttachmentPickerSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/image-attachment-picker.tsx'),
  'utf8',
)
const workflowFieldInputSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/workflow-field-input.tsx'),
  'utf8',
)

assert.match(
  mediaDropSurfaceSource,
  /<button[\s\S]*?\{children \?\? <ImageIcon[\s\S]*?<\/button>[\s\S]*?\{actions \? \(/,
  'media drop surface should render selected content inside the drop button and actions as siblings',
)
assert.doesNotMatch(
  uploadPageSectionsSource,
  /export function DropSurface/,
  'upload sections should use the shared media drop surface instead of owning another implementation',
)
assert.match(
  localFilePreviewsSource,
  /URL\.createObjectURL\(file\)[\s\S]*?URL\.revokeObjectURL\(preview\.url\)/,
  'local upload previews should revoke every object URL they create',
)
assert.match(
  uploadPageSectionsSource,
  /useLocalFilePreviews\(uploadFiles, MAX_VISIBLE_FILES\)[\s\S]*?<UploadFilePreviewTile[\s\S]*?onRemove=\{\(\) => onRemoveUploadFile\(index\)\}/,
  'multi-file upload selection should render thumbnail tiles with individual removal',
)
assert.match(
  uploadPageSource,
  /onRemoveUploadFile=\{\(index\) => \{[\s\S]*?current\.filter\(\(_, currentIndex\) => currentIndex !== index\)[\s\S]*?resetUploadState\(\)/,
  'removing one selected upload file should also clear stale upload results',
)
assert.match(
  imageAttachmentPickerSource,
  /selectedImage\?: SelectedImageDraft \| null[\s\S]*?if \(uploadOnly\)[\s\S]*?<MediaFileDropSurface[\s\S]*?<InlineMediaPreview/,
  'simple image uploads should replace the empty drop target with the selected image preview',
)
assert.match(
  workflowFieldInputSource,
  /selectedImage=\{isSimpleImageUpload \? imageValue : null\}[\s\S]*?\{imageValue && !isSimpleImageUpload \? \(/,
  'simple workflow image fields should not keep the legacy preview card below the selected drop surface',
)
assert.doesNotMatch(
  uploadPageSectionsSource,
  /<img src=\{extractPreviewUrl\}/,
  'preview/extract should not render a second loose image below the selected drop surface',
)

console.log('Upload media selection contracts verified.')
