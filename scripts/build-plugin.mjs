import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const local = args[0] === '--local'
const name = args[local ? 1 : 0] ?? (local ? '' : 'text-editor')
if (args.length > (local ? 2 : 1) || !/^[a-z][a-z0-9-]+$/.test(name)) throw new Error('Usage: node scripts/build-plugin.mjs [--local] <plugin-name>')
const source = path.join(root, local ? 'local-plugins' : 'plugins', name)
const zip = new AdmZip()
// Package runtime assets only; developer guides are not permitted web assets.
zip.addLocalFolder(source, '', entry => !/\.md$/i.test(entry))
zip.addLocalFile(path.join(root, 'plugins', 'sdk', 'conai-plugin.js'))
zip.addLocalFile(path.join(root, 'plugins', 'sdk', 'conai-plugin.css'))
const output = path.join(root, 'build-output', local ? 'local-plugins' : 'plugins', `${name}.zip`)
fs.mkdirSync(path.dirname(output), { recursive: true })
zip.writeZip(output)
console.log(output)
