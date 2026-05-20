import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const comfyHomeSectionsSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-home-sections.tsx'),
  'utf8',
)

assert.match(
  comfyHomeSectionsSource,
  /const filePathSetByFolder = new Map<string, Set<string>>\(\)/,
  'Comfy dropdown auto-collect should create one Set cache per folder while scanning selected files',
)

assert.match(
  comfyHomeSectionsSource,
  /let bucketFileSet = filePathSetByFolder\.get\(displayName\)[\s\S]*?bucketFileSet = new Set\(bucket\.files\)[\s\S]*?filePathSetByFolder\.set\(displayName, bucketFileSet\)/,
  'auto-collect duplicate tracking should reuse the per-folder Set instead of rebuilding from files repeatedly',
)

assert.match(
  comfyHomeSectionsSource,
  /if \(!bucketFileSet\.has\(modelOptionPath\)\) \{\s*bucketFileSet\.add\(modelOptionPath\)\s*bucket\.files\.push\(modelOptionPath\)\s*\}/,
  'auto-collect should gate file pushes through Set.has/Set.add membership checks',
)

assert.doesNotMatch(
  comfyHomeSectionsSource,
  /bucket\.files\.includes\(modelOptionPath\)/,
  'auto-collect must not rescan each folder file list for every selected model file',
)

assert.match(
  comfyHomeSectionsSource,
  /sourcePath: selectedRootName,/,
  'auto-collect preview should keep reporting the selected source folder path',
)

console.log('Comfy dropdown auto-collect contracts verified.')
