import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
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
if (bundled) requireVersionBump()
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
// A fixed entry time makes the package bytes depend on content only: the server replaces an official package when its
// digest differs, so an unchanged plugin must not look new after every build.
for (const entry of zip.getEntries()) entry.header.time = new Date(2000, 0, 1)
const output = bundled
  ? path.join(root, 'backend', 'dist', 'bundled-plugins', `${name}.zip`)
  : path.join(root, 'build-output', local ? 'local-plugins' : 'plugins', `${name}.zip`)
fs.mkdirSync(path.dirname(output), { recursive: true })
zip.writeZip(output)
console.log(output)

/**
 * An official package whose files changed must carry a new version: the version is how an applied update shows in plugin
 * management. Compares the folder with the commit that set the current version; skipped without Git history (Docker build)
 * and while the new version is not committed yet.
 */
function requireVersionBump() {
  const folder = `plugins/${name}`
  const { version } = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'))
  const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  let changed
  try {
    const base = git('log', '-1', '--format=%H', `-S"version": "${version}"`, '--', `${folder}/plugin.json`)
    if (!base) return
    changed = [git('diff', '--name-only', base, '--', folder), git('ls-files', '--others', '--exclude-standard', '--', folder)].join('\n')
  } catch { return }
  // Developer guides are not packaged.
  const files = changed.split('\n').filter(file => file && !/\.md$/i.test(file))
  if (files.length) throw new Error(`${folder} changed since version ${version} was set (${files.slice(0, 5).join(', ')}${files.length > 5 ? ', …' : ''}). Raise "version" in ${folder}/plugin.json.`)
}
