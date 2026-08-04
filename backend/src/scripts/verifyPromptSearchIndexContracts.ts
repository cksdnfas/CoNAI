import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Prompt search index contracts (HEAVY-1).
 *
 * The index only stays correct while three separate things agree:
 *  1. The text the migration's triggers write and the text the backfill writes must
 *     be byte-identical. FTS5 external-content indexes corrupt silently when a
 *     `'delete'` command supplies values that differ from what was inserted.
 *  2. The search path must keep the original LIKE predicate next to any index hit.
 *     The index is a superset filter, not a replacement — dropping the LIKE would
 *     change results (case folding, and any future tokenizer change).
 *  3. Search must fall back to LIKE while the backfill is unfinished, and must never
 *     use the index for a needle shorter than one trigram.
 */

const projectRoot = path.resolve(__dirname, '../..');
const migrationSource = fs.readFileSync(
  path.join(projectRoot, 'src/database/migrations/031_add_media_prompt_search_index.ts'),
  'utf8',
);
const serviceSource = fs.readFileSync(
  path.join(projectRoot, 'src/services/promptSearchIndexService.ts'),
  'utf8',
);
const helpersSource = fs.readFileSync(
  path.join(projectRoot, 'src/models/Image/ImageSearchHelpers.ts'),
  'utf8',
);
const handlerSource = fs.readFileSync(
  path.join(projectRoot, 'src/services/runtimeJobs/handlers/promptSearchIndexHandlers.ts'),
  'utf8',
);

/** Collapse whitespace and the alias/prefix so both copies of the SQL compare equal. */
function normalizeIndexedTextSql(sql: string): string {
  return sql
    .replace(/\$\{prefix\}|\bNEW\b|\bOLD\b|\bim\b/g, 'ROW')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker after: ${startMarker}`);
  return source.slice(start + startMarker.length, end);
}

// 1. migration ↔ runtime SQL parity
const migrationPositive = extractBetween(migrationSource, 'function positiveTextSql(prefix: string): string {\n  return `', '`;\n}');
const migrationNegative = extractBetween(migrationSource, 'function negativeTextSql(prefix: string): string {\n  return `', '`;\n}');
const servicePositive = extractBetween(serviceSource, 'export const POSITIVE_TEXT_SQL = `', '`;');
const serviceNegative = extractBetween(serviceSource, 'export const NEGATIVE_TEXT_SQL = `', '`;');

assert.equal(
  normalizeIndexedTextSql(servicePositive),
  normalizeIndexedTextSql(migrationPositive),
  'the backfill and the sync triggers must index identical positive text; a mismatch corrupts the FTS index',
);
assert.equal(
  normalizeIndexedTextSql(serviceNegative),
  normalizeIndexedTextSql(migrationNegative),
  'the backfill and the sync triggers must index identical negative text; a mismatch corrupts the FTS index',
);

// 2. migration must not index anything itself — every write it emits has to be a
// per-row trigger body keyed on NEW/OLD, never a bulk scan of media_metadata.
for (const match of migrationSource.matchAll(/INSERT INTO media_prompt_fts\b/g)) {
  const statement = migrationSource.slice(match.index!, match.index! + 260);
  assert.match(
    statement,
    /\b(NEW|OLD)\.rowid\b/,
    'migration 031 must only write to the index from row triggers; a bulk backfill there would block the first boot',
  );
}
assert.doesNotMatch(
  migrationSource,
  /'rebuild'/,
  "migration 031 must not issue an FTS5 'rebuild'; it would index the whole table synchronously",
);
assert.match(
  migrationSource,
  /tokenize='trigram'/,
  'the index must use the trigram tokenizer, which is what makes a phrase match equal a LIKE substring match',
);
assert.match(
  migrationSource,
  /VALUES \(1, 'pending', 0, 0\)/,
  'a fresh index must start in the pending state so search keeps using LIKE until the backfill finishes',
);
assert.match(
  migrationSource,
  /s\.status = 'ready' OR \$\{rowidExpression\} <= s\.last_rowid/,
  'sync triggers must ignore rows above the backfill watermark; a delete for an unindexed row corrupts FTS5',
);

// 3. the LIKE predicate must survive next to the index hit
const positiveConditionBlock = extractBetween(
  helpersSource,
  'export function appendPositivePromptSearchCondition(',
  'export type ActiveFileMode',
);
assert.match(
  positiveConditionBlock,
  /appendPromptIndexPrefilter\(/,
  'positive prompt search should offer the index prefilter',
);
assert.match(
  positiveConditionBlock,
  /prompt LIKE \?\$\{SQL_LIKE_ESCAPE_CLAUSE\}/,
  'positive prompt search must keep the escaped LIKE predicate so results stay identical to the pre-index behaviour',
);
assert.match(
  positiveConditionBlock,
  /json_each\(\$\{tableAlias\}\.raw_nai_parameters, '\$\.v4_prompt\.caption\.char_captions'\)/,
  'the NAI character caption fallback must stay in the SQL predicate, not only in the index',
);
assert.match(
  helpersSource,
  /appendPromptIndexPrefilter\(conditions, params, 'negative_text'[\s\S]{0,200}?negative_prompt LIKE \?\$\{SQL_LIKE_ESCAPE_CLAUSE\}/,
  'negative prompt search must keep its escaped LIKE predicate alongside the index prefilter',
);

// 4. fallback rules
assert.match(
  serviceSource,
  /const MIN_TRIGRAM_LENGTH = 3/,
  'needles shorter than one trigram must not be answered by the index',
);
assert.match(
  serviceSource,
  /if \(\[\.\.\.needle\]\.length < MIN_TRIGRAM_LENGTH\) \{\s*return null;/,
  'the short-needle guard must return no prefilter instead of an empty match',
);
assert.match(
  serviceSource,
  /if \(!this\.isReady\(\)\) \{\s*return null;/,
  'an unfinished backfill must fall back to the LIKE path',
);
assert.match(
  serviceSource,
  /needle\.replace\(\/"\/g, '""'\)/,
  'the needle must be escaped into a single FTS5 phrase so no user input can be parsed as query syntax',
);

// 5. the backfill job must stay interruptible and bounded
assert.match(
  handlerSource,
  /ctx\.throwIfCancelled\(\)/,
  'the backfill must check for cancellation at the batch boundary',
);
assert.match(
  handlerSource,
  /await ctx\.yield\(\)/,
  'the backfill must yield to the event loop between batches',
);
assert.match(
  handlerSource,
  /markReady\(\)/,
  'the backfill must flip the index live once it reaches the end of the table',
);

// 6. end-to-end behaviour on a real database
const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-prompt-index-'));
process.env.RUNTIME_BASE_PATH = runtimeBase;

async function main() {
  const { db, closeDatabase } = await import('../database/init');
  const { PromptSearchIndexService } = await import('../services/promptSearchIndexService');
  const migration = await import('../database/migrations/031_add_media_prompt_search_index');

  try {
    db.exec(`
      CREATE TABLE media_metadata (
        composite_hash TEXT PRIMARY KEY,
        prompt TEXT,
        negative_prompt TEXT,
        character_prompt_text TEXT,
        raw_nai_parameters TEXT,
        auto_tags TEXT
      );
      CREATE TABLE image_files (
        id INTEGER PRIMARY KEY,
        composite_hash TEXT,
        original_file_path TEXT,
        file_status TEXT
      );
    `);

    await migration.up(db as any);
    PromptSearchIndexService.invalidateStateCache();

    assert.equal(PromptSearchIndexService.readState().status, 'pending', 'a fresh index starts pending');
    assert.equal(PromptSearchIndexService.isReady(), false, 'a pending index must not be used by search');
    assert.equal(
      PromptSearchIndexService.buildPrefilter('positive_text', 'needle', 'im'),
      null,
      'a pending index must produce no prefilter, so search runs the original LIKE query',
    );

    const insert = db.prepare(`
      INSERT INTO media_metadata (composite_hash, prompt, negative_prompt, character_prompt_text, raw_nai_parameters)
      VALUES (?, ?, ?, ?, ?)
    `);
    insert.run('hash-a', 'literal 100% prompt', 'avoid bad_value', '', '{}');
    insert.run('hash-b', 'literal 100x prompt', 'avoid badXvalue', '', '{}');
    insert.run('hash-c', 'BRASS band', '', 'char alpha', JSON.stringify({
      v4_prompt: { caption: { char_captions: [{ char_caption: 'purple hair' }] } },
    }));
    insert.run('hash-d', 'broken json row', '', '', 'not json at all');

    // Backfill exactly like the runtime job does.
    let cursor = PromptSearchIndexService.readState().lastRowid;
    const maxRowid = PromptSearchIndexService.readMaxRowid();
    while (cursor < maxRowid) {
      const target = Math.min(cursor + 2, maxRowid);
      PromptSearchIndexService.indexRowidRange(cursor, target);
      cursor = target;
    }
    PromptSearchIndexService.markReady();
    assert.equal(PromptSearchIndexService.isReady(), true, 'the backfill must flip the index live');

    const matchRowids = (column: 'positive_text' | 'negative_text', needle: string): string[] => {
      const prefilter = PromptSearchIndexService.buildPrefilter(column, needle, 'im');
      assert.ok(prefilter, `expected a prefilter for ${needle}`);
      return (db.prepare(`
        SELECT im.composite_hash FROM media_metadata im WHERE ${prefilter!.sql} ORDER BY im.composite_hash
      `).all(...prefilter!.params) as Array<{ composite_hash: string }>).map((row) => row.composite_hash);
    };

    assert.deepEqual(matchRowids('positive_text', '100%'), ['hash-a'], '% must stay literal inside the index phrase');
    assert.deepEqual(matchRowids('negative_text', 'bad_'), ['hash-a'], '_ must stay literal inside the index phrase');
    assert.deepEqual(matchRowids('positive_text', 'ras'), ['hash-c'], 'trigram matching must find substrings inside words like LIKE does');
    assert.deepEqual(matchRowids('positive_text', 'purple hair'), ['hash-c'], 'NAI character captions must be searchable through the index');
    assert.deepEqual(matchRowids('positive_text', 'char alpha'), ['hash-c'], 'character_prompt_text must be searchable through the index');
    assert.deepEqual(matchRowids('positive_text', 'broken json'), ['hash-d'], 'a row with malformed raw_nai_parameters must still be indexed');

    // Triggers keep the index in sync once it is live.
    db.prepare(`UPDATE media_metadata SET prompt = 'literal 100% renamed zulu' WHERE composite_hash = 'hash-a'`).run();
    assert.deepEqual(matchRowids('positive_text', 'zulu'), ['hash-a'], 'an update must add the new terms');
    assert.deepEqual(matchRowids('positive_text', 'prompt'), ['hash-b'], 'an update must remove the stale terms');

    db.prepare(`DELETE FROM media_metadata WHERE composite_hash = 'hash-b'`).run();
    assert.deepEqual(matchRowids('positive_text', '100x'), [], 'a delete must remove the row from the index');

    insert.run('hash-e', 'inserted after ready', '', '', '{}');
    assert.deepEqual(matchRowids('positive_text', 'inserted after'), ['hash-e'], 'a live index must pick up new rows');

    // Updating an unrelated column must not disturb the index (ATAG owns auto_tags).
    db.prepare(`UPDATE media_metadata SET auto_tags = '{"tagger":{}}' WHERE composite_hash = 'hash-c'`).run();
    assert.deepEqual(matchRowids('positive_text', 'purple hair'), ['hash-c'], 'auto_tags writes must leave the prompt index intact');

    // The index itself must still be internally consistent after all of that.
    assert.doesNotThrow(
      () => db.prepare(`INSERT INTO media_prompt_fts(media_prompt_fts, rank) VALUES('integrity-check', 0)`).run(),
      'the FTS index must pass its own integrity check after trigger-driven updates',
    );

    // Short needles never reach the index.
    assert.equal(PromptSearchIndexService.buildPrefilter('positive_text', 'hi', 'im'), null, 'two-character needles must fall back to LIKE');
    assert.equal(PromptSearchIndexService.buildPrefilter('positive_text', '', 'im'), null, 'an empty needle must produce no prefilter');

    // A disabled index behaves like no index at all.
    PromptSearchIndexService.markDisabled('contract test');
    assert.equal(PromptSearchIndexService.isReady(), false, 'a disabled index must not be used by search');
    assert.equal(PromptSearchIndexService.buildPrefilter('positive_text', 'purple hair', 'im'), null, 'a disabled index must produce no prefilter');

    // Rollback must leave a working database behind.
    await migration.down(db as any);
    PromptSearchIndexService.invalidateStateCache();
    assert.equal(PromptSearchIndexService.readState().status, 'absent', 'after rollback the service must report an absent index');
    assert.equal(PromptSearchIndexService.buildPrefilter('positive_text', 'purple hair', 'im'), null, 'without the index every search runs the LIKE path');
    assert.doesNotThrow(
      () => db.prepare(`INSERT INTO media_metadata (composite_hash, prompt) VALUES ('hash-f', 'after rollback')`).run(),
      'writes must keep working after the index is rolled back',
    );

    // Re-running the migration must be safe.
    await migration.up(db as any);
    await migration.up(db as any);
    PromptSearchIndexService.invalidateStateCache();
    assert.equal(PromptSearchIndexService.readState().status, 'pending', 're-applying migration 031 must be idempotent');

    console.log('✅ Prompt search index contracts passed');
  } finally {
    closeDatabase();
    fs.rmSync(runtimeBase, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  fs.rmSync(runtimeBase, { recursive: true, force: true });
  process.exit(1);
});
