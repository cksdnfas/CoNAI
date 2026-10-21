import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import AdmZip from 'adm-zip'
import type { PluginSourceFetch } from '../src/services/plugins/pluginSources'

test('Git plugin installs apply only the reviewed package and keep their link', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-plugin-sources-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const key of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) process.env[`RUNTIME_${key}_DIR`] = path.join(root, key.toLowerCase())
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  t.after(async () => {
    settings.closeUserSettingsDb(); authModule.getAuthDb().close(); main.closeDatabase()
    await new Promise<void>(resolve => { void import('../src/utils/logger').then(({ logger }) => logger.close(resolve)) })
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-plugin-sources-'))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const sources = await import('../src/services/plugins/pluginSources')
  const registry = await import('../src/services/plugins/pluginRegistry')
  const author = await import('../src/services/plugins/pluginAuthoring')
  const sdk = fs.readFileSync(path.resolve(__dirname, '../../plugins/sdk/conai-plugin.js'))
  const status = (code: number, message: RegExp) => (error: Error & { status?: number }) => error.status === code && message.test(error.message)

  const sha = (n: number) => n.toString(16).padStart(40, 'a')
  const archive = (version: string, extra: (zip: AdmZip) => void = () => {}) => {
    const zip = new AdmZip()
    const add = (name: string, text: string) => zip.addFile(`owner-repo-1/${name}`, Buffer.from(text))
    add('README.md', '# repository')
    add('plugins/demo/plugin.json', JSON.stringify({ apiVersion: 1, id: 'git-demo', name: 'Git demo', version, description: '', pages: [{ id: 'main', title: 'Main', entry: 'index.html', accepts: [], actions: [] }] }))
    add('plugins/demo/index.html', '<!doctype html><script type="module" src="app.js"></script>')
    add('plugins/demo/app.js', `// ${version}`)
    add('plugins/demo/README.md', 'author notes')
    add('plugins/demo/.eslintrc.json', '{}')
    add('plugins/demo/.github/ci.yml', 'on: push')
    add('plugins/demo/design.psd', 'layers')
    add('plugins/demo/conai-plugin.js', 'stale repository copy')
    extra(zip)
    return zip.toBuffer()
  }
  // A fake GitHub: the real downloader refuses loopback hosts, so the service takes the fetch function.
  let head = sha(1)
  const archives = new Map([[sha(1), archive('1.0.0')]])
  const fetch: PluginSourceFetch = async (url, options) => {
    if (url === 'https://api.github.com/repos/owner/repo') return Buffer.from(JSON.stringify({ default_branch: 'main' }))
    if (url === 'https://api.github.com/repos/owner/repo/commits/main') { assert.equal(options.accept, 'application/vnd.github.sha'); return Buffer.from(head) }
    const commit = /^https:\/\/api\.github\.com\/repos\/owner\/repo\/zipball\/([0-9a-f]{40})$/.exec(url)?.[1]
    if (commit && archives.has(commit)) return archives.get(commit)!
    throw new Error('HTTP 404')
  }
  const review = (input: Record<string, unknown> = {}) => sources.reviewPluginSource({ url: 'https://github.com/owner/repo.git/', path: 'plugins/demo', ...input }, undefined, fetch)
  const link = () => sources.listPluginSources().get('git-demo')

  await t.test('the plugin folder is packaged with the host SDK; dot, Markdown and unsupported files are skipped; traversal and links are refused', async () => {
    const built = sources.packageRepositoryArchive(archive('1.0.0'), 'plugins/demo')
    assert.deepEqual([...built.assets.keys()].sort(), ['app.js', 'conai-plugin.css', 'conai-plugin.js', 'index.html', 'plugin.json'])
    assert.deepEqual(built.assets.get('conai-plugin.js'), sdk)
    assert.deepEqual([...built.skipped].sort(), ['.eslintrc.json', '.github/ci.yml', 'README.md', 'design.psd'])
    assert.equal(sources.packageRepositoryArchive(archive('1.0.0'), 'plugins/demo').digest, built.digest)
    const traversal = archive('1.0.0', zip => {
      zip.addFile('owner-repo-1/plugins/demo/x/evil.js', Buffer.from('bad'))
      zip.getEntry('owner-repo-1/plugins/demo/x/evil.js')!.entryName = 'owner-repo-1/plugins/demo/../evil.js'
    })
    assert.throws(() => sources.packageRepositoryArchive(traversal, 'plugins/demo'), /경로/)
    const linked = archive('1.0.0', zip => {
      zip.addFile('owner-repo-1/plugins/demo/link.js', Buffer.from('/etc/passwd'))
      zip.getEntry('owner-repo-1/plugins/demo/link.js')!.attr = (0o120777 << 16) >>> 0
    })
    assert.throws(() => sources.packageRepositoryArchive(linked, 'plugins/demo'), /링크/)
    assert.throws(() => sources.packageRepositoryArchive(archive('1.0.0'), ''), /plugin\.json/)
    for (const input of [{ url: 'http://github.com/owner/repo' }, { url: 'https://git.example.com/owner/repo' }, { url: 'https://git.example.com/owner/repo', provider: 'github' }, { ref: 'main..x' }, { path: '../demo' }]) {
      await assert.rejects(review(input), status(400, /./))
    }
  })

  await t.test('reviewing installs nothing; installing applies the reviewed bytes once and retries succeed', async () => {
    const first = await review()
    assert.deepEqual(first.source, { url: 'https://github.com/owner/repo', provider: 'github', ref: 'main', path: 'plugins/demo', commit: sha(1) })
    assert.equal(first.updated, false)
    assert.ok(first.files.every(file => file.change === 'added'))
    assert.throws(() => registry.getPlugin('git-demo', false))
    await assert.rejects(sources.installPluginSource({ reviewId: first.reviewId, digest: '0'.repeat(64) }), status(409, /검토/))
    await assert.rejects(sources.installPluginSource({ reviewId: '0'.repeat(32), digest: first.digest }), status(410, /다시 검토/))
    const installed = await sources.installPluginSource({ reviewId: first.reviewId, digest: first.digest })
    assert.equal(installed.updated, false)
    assert.equal(installed.plugin.enabled, false)
    assert.equal(registry.getPlugin('git-demo', false).digest, first.digest)
    assert.equal(fs.readFileSync(registry.packageFile('git-demo', '1.0.0', 'app.js'), 'utf8'), '// 1.0.0')
    assert.deepEqual(fs.readFileSync(registry.packageFile('git-demo', '1.0.0', 'conai-plugin.js')), sdk)
    assert.equal((await sources.installPluginSource({ reviewId: first.reviewId, digest: first.digest })).plugin.manifest.version, '1.0.0')
    assert.deepEqual(link(), { url: 'https://github.com/owner/repo', provider: 'github', ref: 'main', path: 'plugins/demo', commit: sha(1), modified: false, latestCommit: sha(1), checkedAt: link()!.checkedAt, checkError: null, updateAvailable: false })
  })

  await t.test('update checks store the latest commit or the error; updates keep the reviewed state; ZIP installs keep the link; removal drops it', async () => {
    head = sha(2)
    archives.set(sha(2), archive('1.0.1'))
    const [checked] = await sources.checkPluginSources({}, undefined, fetch)
    assert.equal(checked.pluginId, 'git-demo')
    assert.equal(checked.source.latestCommit, sha(2))
    assert.equal(checked.source.updateAvailable, true)
    const [failed] = await sources.checkPluginSources({ pluginId: 'git-demo' }, undefined, async () => { throw new Error('HTTP 429') })
    assert.match(failed.source.checkError!, /한도/)
    assert.equal(failed.source.latestCommit, sha(2))
    await assert.rejects(sources.checkPluginSources({ pluginId: 'author-none' }, undefined, fetch), status(404, /Git/))

    const update = await review({ url: 'https://github.com/owner/repo' })
    assert.equal(update.updated, true)
    assert.equal(update.previousSource, null)
    assert.equal(update.files.find(file => file.name === 'app.js')?.change, 'changed')
    await registry.setPluginEnabled('git-demo', true)
    await assert.rejects(sources.installPluginSource({ reviewId: update.reviewId, digest: update.digest }), status(409, /활성 상태/))
    const again = await review()
    assert.equal((await sources.installPluginSource({ reviewId: again.reviewId, digest: again.digest })).plugin.enabled, true)
    assert.equal(link()!.commit, sha(2))
    assert.equal(link()!.updateAvailable, false)

    const edited = registry.readInstalledPluginAssets('git-demo').assets
    edited.set('app.js', Buffer.from('// edited locally'))
    await registry.installPlugin(author.packagePluginAssets(edited).bytes)
    assert.equal(link()!.modified, true)
    assert.equal(link()!.commit, sha(2))
    await registry.removePlugin('git-demo')
    assert.equal(sources.listPluginSources().size, 0)
    assert.equal(((await import('../src/services/plugins/pluginStore')).pluginDb().prepare('SELECT COUNT(*) AS n FROM plugin_sources').get() as { n: number }).n, 0)
  })
})
