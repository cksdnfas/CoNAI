import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-danbooru-locale-'));
const dbPath = path.join(runtimeBase, 'danbooru.sqlite');
process.env.DANBOORU_SQLITE_PATH = dbPath;

function createFixtureDb() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      display_name TEXT,
      is_deprecated INTEGER NOT NULL DEFAULT 0,
      post_count INTEGER NOT NULL,
      category_code INTEGER,
      category_name TEXT
    );

    CREATE TABLE tag_translations (
      tag_id INTEGER NOT NULL,
      locale TEXT NOT NULL,
      translated_name TEXT NOT NULL
    );

    CREATE TABLE artists (
      tag_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      post_count INTEGER NOT NULL
    );

    CREATE TABLE characters (
      tag_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      post_count INTEGER NOT NULL
    );

    CREATE TABLE copyrights (
      tag_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      post_count INTEGER NOT NULL
    );

    CREATE TABLE character_copyright_links (
      character_tag_id INTEGER NOT NULL,
      copyright_tag_id INTEGER NOT NULL,
      confidence REAL NOT NULL,
      is_primary INTEGER NOT NULL
    );

    CREATE TABLE character_related_tags (
      character_tag_id INTEGER NOT NULL,
      related_tag_id INTEGER NOT NULL,
      score REAL
    );

    CREATE TABLE taxonomy_nodes (
      id INTEGER PRIMARY KEY,
      node_key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      direct_member_tag_count INTEGER NOT NULL,
      member_tag_count INTEGER NOT NULL
    );

    CREATE TABLE taxonomy_node_translations (
      node_key TEXT NOT NULL,
      locale TEXT NOT NULL,
      translated_title TEXT NOT NULL
    );

    CREATE TABLE taxonomy_tag_memberships (
      taxonomy_node_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL
    );
  `);

  db.prepare(`
    INSERT INTO tags (id, name, normalized_name, display_name, is_deprecated, post_count, category_code, category_name)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  `).run(101, 'general_original', 'general_original', 'general original', 30, 0, 'general');
  db.prepare(`
    INSERT INTO artists (tag_id, name, normalized_name, post_count)
    VALUES (?, ?, ?, ?)
  `).run(201, 'artist_original', 'artist_original', 20);
  db.prepare(`
    INSERT INTO characters (tag_id, name, normalized_name, post_count)
    VALUES (?, ?, ?, ?)
  `).run(301, 'character_original', 'character_original', 10);
  db.prepare(`
    INSERT INTO copyrights (tag_id, name, post_count)
    VALUES (?, ?, ?)
  `).run(401, 'copyright_original', 5);
  db.prepare(`
    INSERT INTO character_copyright_links (character_tag_id, copyright_tag_id, confidence, is_primary)
    VALUES (?, ?, ?, ?)
  `).run(301, 401, 0.9, 1);

  const insertTranslation = db.prepare(`
    INSERT INTO tag_translations (tag_id, locale, translated_name)
    VALUES (?, 'ko', ?)
  `);
  insertTranslation.run(101, '일반 번역명');
  insertTranslation.run(201, '작가 번역명');
  insertTranslation.run(301, '캐릭터 번역명');
  insertTranslation.run(401, '작품 번역명');

  db.close();
}

async function main() {
  createFixtureDb();
  const { danbooruBrowserService } = await import('../services/danbooruBrowserService');

  try {
    const tags = danbooruBrowserService.listTags({ q: '일반 번역명', page: 1, limit: 10 });
    assert.deepEqual(tags.items.map((item) => item.name), ['general_original']);
    assert.equal(tags.items[0]?.translatedName, '일반 번역명');

    const artists = danbooruBrowserService.listArtists({ q: '작가 번역명', page: 1, limit: 10 });
    assert.deepEqual(
      artists.items.map((item) => item.name),
      ['artist_original'],
      'artist search should include Korean tag translations like tags and characters'
    );
    assert.equal(artists.items[0]?.translatedName, '작가 번역명');

    const characters = danbooruBrowserService.listCharacters({ q: '캐릭터 번역명', page: 1, limit: 10 });
    assert.deepEqual(characters.items.map((item) => item.name), ['character_original']);
    assert.equal(characters.items[0]?.translatedName, '캐릭터 번역명');
    assert.equal(
      characters.items[0]?.copyrights[0]?.translatedName,
      '작품 번역명',
      'character copyright payloads should carry Korean translations for localized display'
    );

    console.log('✅ Danbooru browser locale contracts passed');
  } finally {
    fs.rmSync(runtimeBase, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  fs.rmSync(runtimeBase, { recursive: true, force: true });
  process.exit(1);
});
