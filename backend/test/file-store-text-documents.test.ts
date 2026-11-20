import './support/testTemp'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('restarting an interrupted writer or recovery preserves exactly the committed files and versions', { timeout: 60000 }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-file-restart-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }))
  const run = (body: string, exit: number, beforeOpen = '') => {
    const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', `
      const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
      const root = process.env.RUNTIME_BASE_PATH, dir = path.join(root, 'files');
      const user = require('./src/database/userSettingsDb');
      ${beforeOpen}
      user.initializeUserSettingsDb();
      const db = user.getUserSettingsDb(), { FileStoreService: files, fileOwnerKey } = require('./src/services/fileStoreService');
      const { withFileStoreWrites: write, afterFileStoreCommit: committed } = require('./src/services/fileStoreWriteTransaction');
      const { REVISIONS_PER_FILE: limit, FileStoreRevisions: versions } = require('./src/services/fileStoreRevisions');
      const owner = fileOwnerKey(null), note = () => files.findChild(owner, null, 'note.txt');
      const save = text => files.updateText(owner, note().id, text);
      const read = name => files.readEditableText(owner, files.findChild(owner, null, name).id).text;
      const checkFiles = () => {
        for (const [folder, rows] of [[dir, "SELECT id FROM stored_file_entries WHERE kind='file'"],
            [path.join(dir, '.revisions'), 'SELECT id FROM stored_file_revisions']]) {
          assert.deepEqual(fs.readdirSync(folder).filter(n => n.endsWith('.bin')).sort(), db.prepare(rows).pluck().all().map(id => id+'.bin').sort());
        }
      };
      const history = () => versions.list(owner, note().id).map(v => versions.readText(owner, note().id, v.id));
      ${body}
    `], {
      cwd: path.resolve(__dirname, '..'), env: { ...process.env, RUNTIME_BASE_PATH: root, RUNTIME_DATABASE_DIR: path.join(root, 'database'), RUNTIME_SAVE_DIR: path.join(root, 'save') },
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    })
    if (child.error) throw child.error
    assert.equal(child.status, exit, child.stderr || child.stdout)
  }
  run(`
    files.writeText(owner, null, 'note.txt', '0');
    for (let n=1; n<limit; n++) save(String(n));
    save('old');
    write(() => {
      save('not committed'); save('twice');
      files.copyFile(owner, note().id, null, 'orphan.txt');
      process.exit(71);
    });
  `, 71)
  // Die after the first old blob has been reinstalled but before recovery has finished the others.
  run('', 72, `
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => { rename(from, to); if (from.endsWith('.old')) process.exit(72); };
  `)
  run(`
    assert.equal(read('note.txt'), 'old'); assert.equal(note().size, 3);
    assert.equal(files.findChild(owner, null, 'orphan.txt'), null);
    assert.deepEqual(history(), Array.from({length: limit}, (_, i) => String(limit-1-i)));
    checkFiles();
    write(() => {
      committed(() => process.exit(73)); // SQLite committed; normal journal cleanup has not run.
      save('committed');
      assert.throws(() => write(() => { save('discarded savepoint'); throw Error('savepoint'); }), /savepoint/);
      files.copyFile(owner, note().id, null, 'kept.txt');
    });
  `, 73)
  run(`
    assert.equal(read('note.txt'), 'committed'); assert.equal(note().size, 9);
    assert.equal(read('kept.txt'), 'committed'); assert.equal(files.findChild(owner, null, 'orphan.txt'), null);
    assert.deepEqual(history(), ['old', ...Array.from({length: limit-1}, (_, i) => String(limit-1-i))]);
    checkFiles();
    assert.deepEqual(fs.readdirSync(path.join(dir, '.write-journal')), []);
    // This store stays open while another writer dies: even the source of a copy or append must be recovered.
    const crashPeer = () => {
      const code = "require('./src/database/userSettingsDb').initializeUserSettingsDb();"
        + "const {FileStoreService:f,fileOwnerKey}=require('./src/services/fileStoreService');"
        + "require('./src/services/fileStoreWriteTransaction').withFileStoreWrites(()=>{f.updateText(fileOwnerKey(null),process.argv[1],'unfinished');process.exit(74)});";
      const peer = require('node:child_process').spawnSync(process.execPath, ['--import','tsx','-e',code,note().id],
        {env: process.env, encoding:'utf8', timeout:10000, windowsHide:true});
      assert.equal(peer.status, 74, peer.stderr);
    };
    crashPeer();
    files.copyFile(owner, note().id, null, 'snapshot.txt');
    assert.equal(read('snapshot.txt'), 'committed');
    crashPeer();
    files.editText(owner, note().id, text => text + '+');
    assert.equal(read('note.txt'), 'committed+');
    checkFiles();
    user.closeUserSettingsDb();
  `, 0)
})

test('file store text documents: create refuses taken names, update keeps the id and follows the file', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-file-text-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-file-text-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const me = fileOwnerKey(1)
  const read = async (id: string) => (await FileStoreService.readText(me, id, 0, 32000)).text

  const note = FileStoreService.writeText(me, null, '메모.md', '# 처음', { create: true })
  assert.equal(note.mimeType, 'text/markdown')
  assert.equal(await read(note.id), '# 처음')

  await t.test('create refuses a taken name (case-insensitive) and non-text extensions', () => {
    assert.throws(() => FileStoreService.writeText(me, null, '메모.MD', 'x', { create: true }), /같은 이름/)
    assert.throws(() => FileStoreService.writeText(me, null, '그림.png', 'x', { create: true }), /텍스트 파일만/)
  })

  await t.test('update replaces the text in place', async () => {
    const saved = FileStoreService.updateText(me, note.id, '# 고침\n\n한글 본문')
    assert.equal(saved.id, note.id)
    assert.equal(saved.size, Buffer.byteLength('# 고침\n\n한글 본문'))
    assert.equal(await read(note.id), '# 고침\n\n한글 본문')
  })

  await t.test('a rejected writer record leaves the last bytes, versions and file events intact', async () => {
    const db = dbModule.getUserSettingsDb()
    const { FileStoreRevisions } = await import('../src/services/fileStoreRevisions')
    const before = await read(note.id), versions = FileStoreRevisions.list(me, note.id)
    const revisionDir = path.join(root, 'files', '.revisions')
    const retained = fs.readdirSync(revisionDir).sort(), events: string[] = []
    const unsubscribe = FileStoreService.onChange(change => events.push(change.action))
    db.exec("CREATE TEMP TRIGGER hold_writer BEFORE INSERT ON stored_file_writers BEGIN SELECT RAISE(ABORT, 'held writer'); END")
    try {
      assert.throws(() => FileStoreService.updateText(me, note.id, 'not saved'), /held writer/)
      const upload = path.join(root, 'replacement')
      fs.writeFileSync(upload, 'not uploaded')
      assert.throws(() => FileStoreService.upload(me, null, [{ path: upload, originalname: Buffer.from(note.name).toString('latin1'), mimetype: 'text/markdown' } as never], false, { id: note.id }), /held writer/)
      assert.equal(await read(note.id), before)
      assert.deepEqual(FileStoreRevisions.list(me, note.id), versions)
      assert.deepEqual(fs.readdirSync(revisionDir).sort(), retained)
      assert.deepEqual(events, [])
    } finally { db.exec('DROP TRIGGER hold_writer'); unsubscribe() }
  })

  await t.test('update follows a renamed or moved file', async () => {
    const folder = FileStoreService.createFolder(me, null, '보관')
    FileStoreService.rename(me, note.id, '노트.txt')
    FileStoreService.move(me, [note.id], folder.id)
    const saved = FileStoreService.updateText(me, note.id, '옮긴 뒤')
    assert.equal(saved.id, note.id)
    assert.equal(saved.parentId, folder.id)
    assert.equal(saved.mimeType, 'text/plain')
    assert.equal(FileStoreService.list(me, null).entries.filter((entry) => entry.kind === 'file').length, 0)
    assert.equal(await read(note.id), '옮긴 뒤')
  })

  await t.test('an old editor snapshot cannot replace a same-size newer write', async () => {
    FileStoreService.updateText(me, note.id, '이전 내용')
    const first = FileStoreService.readEditableText(me, note.id)
    const newer = FileStoreService.updateText(me, note.id, '최신 내용', { expectedRevision: first.revision })
    assert.notEqual(newer.revision, first.revision)
    assert.throws(() => FileStoreService.updateText(me, note.id, '오래된값', { expectedRevision: first.revision }), /파일이 변경/)
    assert.equal(await read(note.id), '최신 내용')
    assert.equal((await FileStoreService.readText(me, note.id)).revision, newer.revision)
  })

  await t.test('batch moves respect the entry depth limit without flattening a selection or partially moving it', () => {
    let parent: string | null = null
    for (let depth = 1; depth < 64; depth++) parent = FileStoreService.createFolder(me, parent, `level-${depth}`).id
    const last = FileStoreService.createFolder(me, parent, '마지막')
    const folder = FileStoreService.createFolder(me, null, '묶음')
    const child = FileStoreService.writeText(me, folder.id, '자식.txt', '내용')
    const loose = FileStoreService.writeText(me, null, '별도.txt', '내용')
    assert.throws(() => FileStoreService.move(me, [loose.id], last.id), /64단계/)
    assert.throws(() => FileStoreService.move(me, [loose.id, child.id, folder.id], parent), /64단계/)
    assert.equal(FileStoreService.get(me, loose.id).parentId, null)
    FileStoreService.move(me, [child.id, folder.id, loose.id], FileStoreService.get(me, parent!).parentId)
    assert.equal(FileStoreService.get(me, child.id).parentId, folder.id)
    assert.equal(FileStoreService.get(me, folder.id).parentId, FileStoreService.get(me, loose.id).parentId)
  })

  await t.test('update refuses folders and permits other file editors', () => {
    const folder = FileStoreService.ensureFolder(me, null, '보관')
    assert.throws(() => FileStoreService.updateText(me, folder.id, 'x'), /파일을 선택/)
    assert.equal(FileStoreService.updateText(fileOwnerKey(2), note.id, 'shared').id, note.id)
  })

  await t.test('bounded continuation reads never mix document revisions', async () => {
    const source = '처음 내용\n'.repeat(40)
    const file = FileStoreService.writeText(me, null, '이어읽기.md', source, { create: true })
    const first = await FileStoreService.readText(me, file.id, 0, 32)
    assert.ok(first.nextOffset !== null)
    const next = await FileStoreService.readText(me, file.id, first.nextOffset!, 32, { revision: first.revision })
    assert.equal(next.revision, first.revision)
    FileStoreService.updateText(me, file.id, source.replace('처음', '새로'))
    await assert.rejects(FileStoreService.readText(me, file.id, first.nextOffset!, 32, { revision: first.revision }), (error: unknown) => (error as { status: number }).status === 409)
    const refreshed = await FileStoreService.readText(me, file.id, 0, 32)
    assert.notEqual(refreshed.revision, first.revision)
    assert.ok(refreshed.text.startsWith('새로'))
  })

  await t.test('a folder upload refuses unsafe relative paths without writing anything', () => {
    const target = FileStoreService.createFolder(me, null, '올림')
    const rootTotal = FileStoreService.list(me, null).total
    const staged = (names: string[]) => names.map((name) => {
      fs.writeFileSync(path.join(root, name), name)
      return { path: path.join(root, name), originalname: name, mimetype: 'text/plain', size: name.length } as never
    })
    const files = staged(['ok.txt', 'a.txt'])
    for (const unsafe of ['../a.txt', '/a.txt', '하위//a.txt', 'C:/a.txt', '하위\\a.txt', `${'d/'.repeat(65)}a.txt`]) {
      assert.throws(() => FileStoreService.upload(me, target.id, files, false, undefined, ['하위/ok.txt', unsafe]), (error: unknown) => (error as { status?: number }).status === 400, unsafe)
    }
    assert.equal(FileStoreService.list(me, target.id).total, 0)
    assert.equal(FileStoreService.list(me, null).total, rootTotal)
    const [ok, deep] = FileStoreService.upload(me, target.id, files, false, undefined, ['하위/ok.txt', '하위/깊이/a.txt'])
    const [folder] = FileStoreService.list(me, target.id).entries
    assert.equal(folder.name, '하위')
    assert.equal(ok.parentId, folder.id)
    assert.equal(FileStoreService.get(me, deep.parentId!).parentId, folder.id)
    // A later file's name conflict, after the first file's new folders were created, undoes those folders and files.
    assert.throws(() => FileStoreService.upload(me, target.id, staged(['x.txt', 'ok.txt']), false, undefined, ['새/안쪽/x.txt', '하위/ok.txt']), (error: unknown) => (error as { status?: number }).status === 409)
    assert.deepEqual(FileStoreService.list(me, target.id).entries.map((entry) => entry.name), ['하위'])
    assert.equal(FileStoreService.list(me, folder.id).total, 2)
  })
})
