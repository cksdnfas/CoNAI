import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const comfyHomeSectionsSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-home-sections.tsx'),
  'utf8',
)

for (const defaultPath of ['/models/checkpoints', '/models/diffusion_models', '/models/unet_gguf', '/models/loras']) {
  assert.match(
    comfyHomeSectionsSource,
    new RegExp(defaultPath.replace(/\//g, '\\/')),
    `Comfy dropdown auto-collect should expose default API path ${defaultPath}`,
  )
}

assert.match(
  comfyHomeSectionsSource,
  /<Textarea[\s\S]*value=\{apiPathText\}[\s\S]*onChange=\{\(event\) => setApiPathText\(event\.target\.value\)\}/,
  'auto-collect should use a textarea-driven API path list',
)

assert.match(
  comfyHomeSectionsSource,
  /기본값 초기화/,
  'auto-collect should provide a default reset action',
)

assert.match(
  comfyHomeSectionsSource,
  /await onSubmit\(\{ apiPaths \}\)/,
  'auto-collect should submit API paths, not client-selected folder files',
)

assert.match(
  comfyHomeSectionsSource,
  /통합 \+ 개별 생성[\s\S]*하위 폴더 통합|하위 폴더 통합[\s\S]*통합 \+ 개별 생성/,
  'auto-collect should tell users the fixed merge options are always applied',
)

assert.doesNotMatch(
  comfyHomeSectionsSource,
  /webkitdirectory|directory'|directory"|FolderOpen|modelFolders:|mergeSubfolders\?:|createBoth\?:|collectModelFoldersFromSelection/,
  'auto-collect UI should not expose legacy folder-upload or merge option controls',
)

console.log('Comfy dropdown API auto-collect UI contracts verified.')
