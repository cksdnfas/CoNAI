import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const local = args[0] === '--local'
// --bundled: an official package the app build carries; the server installs it at startup (backend/dist/bundled-plugins).
const bundled = args[0] === '--bundled'
const flagged = local || bundled
const name = args[flagged ? 1 : 0] ?? (flagged ? '' : 'text-editor')
if (args.length > (flagged ? 2 : 1) || !/^[a-z][a-z0-9-]+$/.test(name)) throw new Error('Usage: node scripts/build-plugin.mjs [--local|--bundled] <plugin-name>')
const source = path.join(root, local ? 'local-plugins' : 'plugins', name)
const zip = new AdmZip()
// Skill folders the manifest declares keep their Markdown (SKILL.md and references); it is what they are made of.
const skillFolders = (JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8')).skills ?? []).map(folder => `${String(folder).replace(/\/+$/, '')}/`)
// Package runtime assets only; developer guides are not permitted web assets.
zip.addLocalFolder(source, '', entry => {
  const name = entry.replace(/\\/g, '/')
  return !/\.md$/i.test(name) || skillFolders.some(folder => name.startsWith(folder))
})
zip.addLocalFile(path.join(root, 'plugins', 'sdk', 'conai-plugin.js'))
zip.addLocalFile(path.join(root, 'plugins', 'sdk', 'conai-plugin.css'))
const output = bundled
  ? path.join(root, 'backend', 'dist', 'bundled-plugins', `${name}.zip`)
  : path.join(root, 'build-output', local ? 'local-plugins' : 'plugins', `${name}.zip`)
fs.mkdirSync(path.dirname(output), { recursive: true })
zip.writeZip(output)
console.log(output)
