import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2] ?? 'text-editor'
if (!/^[a-z][a-z0-9-]+$/.test(name)) throw new Error('Use a plugin directory name from plugins/')
const source = path.join(root, 'plugins', name)
const zip = new AdmZip()
zip.addLocalFolder(source)
zip.addLocalFile(path.join(root, 'plugins', 'sdk', 'conai-plugin.js'))
const output = path.join(root, 'build-output', 'plugins', `${name}.zip`)
fs.mkdirSync(path.dirname(output), { recursive: true })
zip.writeZip(output)
console.log(output)
