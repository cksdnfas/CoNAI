import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

/** A dictionary with only what the library's sorting reads: tag categories, taxonomy groups, translations, one character. */
function writeDictionary(file: string) {
  const db = new Database(file)
  db.exec(`
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT, normalized_name TEXT, display_name TEXT, category_code INTEGER, category_name TEXT, post_count INTEGER, is_deprecated INTEGER DEFAULT 0);
    CREATE TABLE tag_aliases (alias_normalized_name TEXT, target_tag_id INTEGER, status TEXT);
    CREATE TABLE tag_translations (tag_id INTEGER, locale TEXT, translated_name TEXT);
    CREATE TABLE taxonomy_nodes (id INTEGER PRIMARY KEY, node_key TEXT, node_type TEXT);
    CREATE TABLE taxonomy_tag_memberships (taxonomy_node_id INTEGER, tag_id INTEGER);
    CREATE TABLE characters (tag_id INTEGER PRIMARY KEY, name TEXT, normalized_name TEXT, post_count INTEGER);
    CREATE TABLE copyrights (tag_id INTEGER PRIMARY KEY, name TEXT, normalized_name TEXT, post_count INTEGER);
    CREATE TABLE character_copyright_links (character_tag_id INTEGER, copyright_tag_id INTEGER, confidence REAL, is_primary INTEGER);
    CREATE TABLE character_related_tags (character_tag_id INTEGER, related_tag_id INTEGER, score REAL);
  `)
  const tag = db.prepare('INSERT INTO tags (id, name, normalized_name, category_code, category_name, post_count) VALUES (?, ?, ?, 0, ?, 10)')
  for (const [id, name, category] of [[1, 'aqua_hair', 'general'], [2, 'school_uniform', 'general'], [3, 'smile', 'general'], [4, 'hatsune_miku', 'character'], [5, 'vocaloid', 'copyright'], [6, 'twintails', 'general']] as const) tag.run(id, name, name, category)
  const node = db.prepare("INSERT INTO taxonomy_nodes (id, node_key, node_type) VALUES (?, ?, 'manual_group')")
  for (const [id, key] of [[10, 'appearance__hair__hair_color'], [11, 'wardrobe__uniforms_costumes'], [12, 'appearance__expression'], [13, 'appearance__hair__hair_style']] as const) node.run(id, key)
  const member = db.prepare('INSERT INTO taxonomy_tag_memberships VALUES (?, ?)')
  for (const [nodeId, tagId] of [[10, 1], [11, 2], [12, 3], [13, 6]]) member.run(nodeId, tagId)
  db.prepare("INSERT INTO tag_translations VALUES (1, 'ko', '물빛 머리')").run()
  db.prepare("INSERT INTO characters VALUES (4, 'hatsune_miku', 'hatsune_miku', 100)").run()
  db.prepare("INSERT INTO copyrights VALUES (5, 'vocaloid', 'vocaloid', 50)").run()
  db.prepare('INSERT INTO character_copyright_links VALUES (4, 5, 1, 1)').run()
  const related = db.prepare('INSERT INTO character_related_tags VALUES (4, ?, ?)')
  // smile is an expression (left out of a fill); school_uniform is below the frequent-tag score.
  for (const [tagId, score] of [[1, 0.47], [6, 0.29], [3, 0.2], [2, 0.05]]) related.run(tagId, score)
  db.close()
}

test('character looks: dictionary sorting, legacy text, tag search and filters, atomic bulk moves and imports', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-character-look-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  process.env.RUNTIME_TEMP_DIR = path.join(root, 'temp')
  const dictionary = path.join(root, 'danbooru.sqlite')
  writeDictionary(dictionary)
  process.env.DANBOORU_SQLITE_PATH = dictionary
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  const images = await import('../src/database/init')
  await images.initializeDatabase()
  const library = await import('../src/services/characterLibrary')
  const { fillCharacterAppearance } = await import('../src/services/characterAppearanceTags')
  const { danbooruBrowserService } = await import('../src/services/danbooruBrowserService')
  const { ensureCharacterLibrarySchema } = await import('../src/database/characterLibrarySchema')
  t.after(async () => {
    danbooruBrowserService.close()
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    images.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(root), os.tmpdir())
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  // A Danbooru character's fill: its tag and work, frequent appearance tags; expressions and rare tags left out.
  const fill = await fillCharacterAppearance({ source: 'danbooru', character: 'Hatsune Miku' }, true)
  assert.equal(fill.sections.identity, 'hatsune miku, vocaloid')
  assert.equal(fill.sections.hair, 'aqua hair, twintails')
  assert.equal(fill.sections.other, '')
  assert.equal(fill.outfitTags, '')

  // A plain text keeps every term and its emphasis: outfit tags become the default outfit, the rest stays in order.
  const miku = library.createCharacterSetting({ folderId: null, name: 'Miku', appearance: 'Hatsune Miku, (aqua hair:1.2), school uniform, smile' })
  assert.equal(miku.sections.identity, 'Hatsune Miku')
  assert.equal(miku.sections.hair, '(aqua hair:1.2)')
  assert.equal(miku.sections.other, 'smile')
  assert.deepEqual(miku.outfits, [{ name: '기본', tags: 'school uniform' }])
  assert.equal(miku.appearance, 'Hatsune Miku, (aqua hair:1.2), smile, school uniform')

  // The same text again keeps a structure edited since; sections and a second outfit recompose the text.
  const edited = library.patchCharacterSetting(miku.id, { revision: miku.revision, outfits: [{ name: '기본', tags: 'school uniform' }, { name: 'Swim', tags: 'swimsuit' }] })
  const unchanged = library.patchCharacterSetting(miku.id, { revision: edited.revision, appearance: edited.appearance })
  assert.equal(unchanged.outfits.length, 2)
  const recomposed = library.patchCharacterSetting(miku.id, { revision: unchanged.revision, sections: { other: '' } })
  assert.equal(recomposed.appearance, 'Hatsune Miku, (aqua hair:1.2), school uniform')
  assert.throws(() => library.patchCharacterSetting(miku.id, { revision: recomposed.revision, appearance: 'x', sections: { hair: 'y' } }), /함께 보낼 수 없어/)

  // Search reaches tags of every outfit and Korean tag names; filters are per dimension.
  const ids = (input: unknown) => library.listCharacterSettings(input).items.map((item) => item.id)
  assert.deepEqual(ids({ query: 'swimsuit' }), [miku.id])
  assert.deepEqual(ids({ query: '물빛' }), [miku.id])
  assert.deepEqual(ids({ filters: { hairColor: ['aqua_hair'] } }), [miku.id])
  assert.deepEqual(ids({ filters: { hairColor: ['aqua_hair'], outfit: ['bikini'] } }), [])
  const facets = library.characterLibraryFacets({})
  assert.equal(facets.available, true)
  assert.deepEqual(facets.dimensions.find((dimension) => dimension.key === 'hairColor')?.values, [{ tag: 'aqua_hair', label: '물빛 머리', translated: '물빛 머리', count: 1 }])

  // A setting stored before sections reads its text as `other` and is indexed at startup.
  const db = settings.getUserSettingsDb()
  const legacyId = Number(db.prepare("INSERT INTO character_settings (folder_id, name, appearance, sections) VALUES (NULL, 'Legacy', 'red hair', NULL)").run().lastInsertRowid)
  ensureCharacterLibrarySchema(db)
  assert.equal(library.getCharacterSetting(legacyId).sections.other, 'red hair')
  assert.deepEqual(ids({ query: 'red hair' }), [legacyId])

  // A taken name in the destination refuses the whole move: nothing moves.
  const folder = library.createCharacterFolder({ parentId: null, name: 'Work' })
  library.createCharacterSetting({ folderId: folder.id, name: 'Legacy' })
  assert.throws(() => library.bulkCharacterSettings({ action: 'move', ids: [miku.id, legacyId], folderId: folder.id }), /같은 이름/)
  assert.equal(library.getCharacterSetting(miku.id).folderId, null)
  assert.equal(library.bulkCharacterSettings({ action: 'favorite', ids: [miku.id], favorite: true }).changed, 1)
  assert.deepEqual(ids({ favorite: true }), [miku.id])

  // Profiles and workflows wear an outfit by name (case-insensitive); a gone name is the default one. Names are unique.
  const row = library.characterSettingRow(miku.id)
  assert.equal(library.characterSettingAppearance(row, 'swim'), 'Hatsune Miku, (aqua hair:1.2), swimsuit')
  assert.equal(library.characterSettingAppearance(row, 'Gone'), recomposed.appearance)
  assert.throws(() => library.patchCharacterSetting(miku.id, { revision: recomposed.revision, outfits: [{ name: 'A', tags: 'x' }, { name: 'a', tags: 'y' }] }), /의상 이름이 겹쳐/)

  // An exported bundle imported where its name is taken gets a number and keeps its look and favorite mark.
  const { writeZip } = await import('../src/utils/zipArchive')
  const exported = library.exportCharacterLibrary({ ids: [miku.id] }, true)
  const bundlePath = path.join(root, 'bundle.zip')
  await writeZip(bundlePath, [{ name: library.CHARACTER_BUNDLE_DOCUMENT, data: Buffer.from(JSON.stringify(exported.document)) }, ...exported.files.map((file) => ({ name: file.name, file: file.path }))])
  const imported = await library.importCharacterLibrary({ folderId: null, bundlePath }, true, true)
  assert.deepEqual(imported, { createdSettings: 1, createdFolders: 0, renamed: 1, importedImages: 0, droppedImages: 0 })
  const copy = library.listCharacterSettings({ folderId: null, query: 'Miku (2)' }).items[0]
  assert.ok(copy?.favorite)
  assert.equal(library.getCharacterSetting(copy.id).appearance, recomposed.appearance)
  await assert.rejects(library.importCharacterLibrary({ folderId: null, bundlePath: dictionary }, true, true), /외형 묶음/)
})
