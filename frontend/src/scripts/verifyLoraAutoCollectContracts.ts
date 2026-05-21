import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const loraAutoCollectModalSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/lora-auto-collect-modal.tsx'),
  'utf8',
)

assert.match(
  loraAutoCollectModalSource,
  /function getRelativeFilePath\(file: RelativeFile\)[\s\S]*return file\.webkitRelativePath \?\? file\.name/,
  'LoRA auto-collect should normalize relative file paths through one helper',
)
assert.match(
  loraAutoCollectModalSource,
  /function isLoraModelFile\(file: RelativeFile\)[\s\S]*file\.name\.toLocaleLowerCase\(\)\.endsWith\('\.safetensors'\)/,
  'LoRA auto-collect should accept case-varied safetensors extensions',
)
assert.match(
  loraAutoCollectModalSource,
  /const fileByRelativePath = new Map<string, RelativeFile>\(\)/,
  'LoRA auto-collect should build a relative-path lookup for selected files',
)
assert.match(
  loraAutoCollectModalSource,
  /fileByRelativePath\.set\(relativePath, file\)/,
  'LoRA auto-collect should index each selected file by relative path once',
)
assert.match(
  loraAutoCollectModalSource,
  /const pairedTextFile = fileByRelativePath\.get\(pairedTextPath\)/,
  'LoRA auto-collect should resolve paired prompt text files by lookup, not a repeated scan',
)
assert.doesNotMatch(
  loraAutoCollectModalSource,
  /files\.find\(\(candidate\) => \(candidate\.webkitRelativePath \?\? candidate\.name\) === pairedTextPath\)/,
  'LoRA auto-collect should avoid scanning the full folder once per LoRA file',
)

console.log('LoRA auto-collect contracts verified.')
