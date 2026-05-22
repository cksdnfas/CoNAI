import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Database = require('better-sqlite3')
import { configureAttachedSqliteDatabase, configureSqliteConnection } from '../database/sqlitePragmas'

function assertConnectionPragmas(db: Database.Database, label: string) {
  assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal', `${label} must use WAL journal mode`)
  assert.equal(Number(db.pragma('synchronous', { simple: true })), 1, `${label} must use synchronous=NORMAL`)
  assert.equal(Number(db.pragma('busy_timeout', { simple: true })), 5000, `${label} must keep a 5000ms busy timeout`)
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-sqlite-pragmas-'))
  const mainPath = path.join(tempDir, 'main.db')
  const attachedPath = path.join(tempDir, 'attached.db')
  const db = new Database(mainPath)

  try {
    configureSqliteConnection(db, { label: 'pragma-contract-main.db' })
    assertConnectionPragmas(db, 'main temp db')

    const escapedAttachedPath = attachedPath.replace(/'/g, "''")
    db.exec(`ATTACH DATABASE '${escapedAttachedPath}' AS attached_db`)
    configureAttachedSqliteDatabase(db, 'attached_db', 'attached temp db')

    assert.equal(String(db.pragma('attached_db.journal_mode', { simple: true })).toLowerCase(), 'wal', 'attached temp db must use WAL journal mode')
    assert.equal(Number(db.pragma('attached_db.synchronous', { simple: true })), 1, 'attached temp db must use synchronous=NORMAL')

    console.log('✅ SQLite pragma contracts passed (WAL, synchronous=NORMAL, busy timeout)')
  } finally {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main()
