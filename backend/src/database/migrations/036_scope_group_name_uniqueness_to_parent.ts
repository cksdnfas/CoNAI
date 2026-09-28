import type { Database } from 'better-sqlite3'

/**
 * groups.name 의 전역 UNIQUE 를 "같은 부모 안에서만 고유(대소문자 무시)"로 바꾼다.
 *
 * - `프로젝트A/이펙트` 와 `프로젝트B/이펙트` 가 공존할 수 있어야 경로 기반 그룹 할당이 가능하다.
 * - 루트끼리도 COALESCE(parent_id, 0) 으로 한 형제 집합이 되므로 루트 이름은 계속 고유하다.
 *   (UNIQUE(parent_id, name) 만 걸면 SQLite 가 NULL 을 서로 다르게 봐서 루트 중복이 허용된다.)
 *
 * 인라인 UNIQUE 는 테이블 재생성 없이 지울 수 없다. 마이그레이션은 BEGIN IMMEDIATE 안에서 돌고
 * foreign_keys 는 트랜잭션 안에서 끌 수 없으므로, DROP TABLE groups 가 image_groups 를
 * CASCADE 로 비운다. 그래서 두 테이블을 TEMP 로 백업한 뒤 id 를 보존해 되돌려 넣는다.
 */

export const GROUP_PARENT_NAME_UNIQUE_INDEX = 'idx_groups_parent_name_nocase'

const GROUPS_BACKUP = '_mig036_groups_backup'
const IMAGE_GROUPS_BACKUP = '_mig036_image_groups_backup'

function hasTable(db: Database, name: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function tableColumns(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>).map((c) => c.name)
}

/** groups.name 단독 인라인 UNIQUE(sqlite_autoindex) 가 남아 있는지 확인한다. */
function hasGlobalNameUnique(db: Database): boolean {
  const indexes = db.prepare("PRAGMA index_list('groups')").all() as Array<{ name: string; unique: number; origin: string }>
  return indexes.some((index) => {
    if (index.unique !== 1 || index.origin !== 'u') {
      return false
    }
    const columns = db.prepare(`PRAGMA index_info(${quoteIdent(index.name)})`).all() as Array<{ name: string }>
    return columns.length === 1 && columns[0].name === 'name'
  })
}

/** 같은 부모 안에서 대소문자만 다른 이름을 ` (2)` 식 접미사로 비켜 준다. */
function resolveCaseInsensitiveSiblingConflicts(db: Database): Array<{ id: number; from: string; to: string }> {
  const conflicts = db.prepare(`
    SELECT g.id, g.name, COALESCE(g.parent_id, 0) AS parent_key
    FROM groups g
    WHERE EXISTS (
      SELECT 1 FROM groups o
      WHERE COALESCE(o.parent_id, 0) = COALESCE(g.parent_id, 0)
        AND o.name = g.name COLLATE NOCASE
        AND o.id < g.id
    )
    ORDER BY g.id
  `).all() as Array<{ id: number; name: string; parent_key: number }>

  const nameTaken = db.prepare(`
    SELECT 1 FROM groups
    WHERE COALESCE(parent_id, 0) = ? AND name = ? COLLATE NOCASE AND id != ?
    LIMIT 1
  `)
  const rename = db.prepare('UPDATE groups SET name = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?')
  const renamed: Array<{ id: number; from: string; to: string }> = []

  for (const conflict of conflicts) {
    let suffix = 2
    let candidate = `${conflict.name} (${suffix})`
    while (nameTaken.get(conflict.parent_key, candidate, conflict.id)) {
      suffix += 1
      candidate = `${conflict.name} (${suffix})`
    }
    rename.run(candidate, conflict.id)
    renamed.push({ id: conflict.id, from: conflict.name, to: candidate })
  }

  return renamed
}

function rebuildGroupsWithoutGlobalUnique(db: Database): void {
  const tableSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'groups'").get() as { sql: string }).sql
  const rebuiltSql = tableSql.replace(/(\bname\b[^,]*?)\s+UNIQUE\b/i, '$1')
  if (rebuiltSql === tableSql) {
    throw new Error('036: groups.name UNIQUE 정의를 CREATE TABLE 문에서 찾지 못했습니다')
  }

  const indexSqls = (db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'groups' AND sql IS NOT NULL
  `).all() as Array<{ sql: string }>).map((row) => row.sql)
  const previousSequence = (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'groups'").get() as { seq: number } | undefined)?.seq ?? null

  const groupColumns = tableColumns(db, 'groups')
  const imageGroupColumns = tableColumns(db, 'image_groups')
  const groupCount = (db.prepare('SELECT COUNT(*) AS c FROM groups').get() as { c: number }).c
  const imageGroupCount = (db.prepare('SELECT COUNT(*) AS c FROM image_groups').get() as { c: number }).c

  db.exec(`DROP TABLE IF EXISTS temp.${GROUPS_BACKUP}`)
  db.exec(`DROP TABLE IF EXISTS temp.${IMAGE_GROUPS_BACKUP}`)
  db.exec(`CREATE TEMP TABLE ${GROUPS_BACKUP} AS SELECT * FROM main.groups`)
  db.exec(`CREATE TEMP TABLE ${IMAGE_GROUPS_BACKUP} AS SELECT * FROM main.image_groups`)

  // FK 가 켜져 있어 DROP 이 어차피 image_groups 를 CASCADE 로 비운다. 부모 테이블이 사라진 뒤에는
  // image_groups 에 대한 DML 이 FK 조회에서 실패하므로 먼저 비우고(백업에서 복원한다) DROP 한다.
  db.exec('DELETE FROM main.image_groups')
  db.exec('DROP TABLE main.groups')
  db.exec(rebuiltSql)

  // 부모가 뒤 id 인 경우가 있어 parent_id 는 두 번째 패스에서 채운다(즉시 FK 검사 회피).
  const nonParentColumns = groupColumns.filter((column) => column !== 'parent_id').map(quoteIdent).join(', ')
  db.exec(`
    INSERT INTO main.groups (${nonParentColumns})
    SELECT ${nonParentColumns} FROM temp.${GROUPS_BACKUP} ORDER BY id
  `)
  if (groupColumns.includes('parent_id')) {
    db.exec(`
      UPDATE main.groups
      SET parent_id = (
        SELECT b.parent_id FROM temp.${GROUPS_BACKUP} b
        WHERE b.id = groups.id
          AND b.parent_id IN (SELECT id FROM main.groups)
      )
    `)
  }

  const imageGroupColumnList = imageGroupColumns.map(quoteIdent).join(', ')
  const restored = db.prepare(`
    INSERT INTO main.image_groups (${imageGroupColumnList})
    SELECT ${imageGroupColumnList} FROM temp.${IMAGE_GROUPS_BACKUP} b
    WHERE b.group_id IN (SELECT id FROM main.groups)
      AND b.composite_hash IN (SELECT composite_hash FROM main.media_metadata)
    ORDER BY b.id
  `).run().changes

  for (const sql of indexSqls) {
    db.exec(sql)
  }

  if (previousSequence !== null) {
    const updated = db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'groups'").run(previousSequence).changes
    if (updated === 0) {
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('groups', ?)").run(previousSequence)
    }
  }

  db.exec(`DROP TABLE temp.${GROUPS_BACKUP}`)
  db.exec(`DROP TABLE temp.${IMAGE_GROUPS_BACKUP}`)

  const restoredGroups = (db.prepare('SELECT COUNT(*) AS c FROM groups').get() as { c: number }).c
  if (restoredGroups !== groupCount) {
    throw new Error(`036: groups 복원 수 불일치 (${restoredGroups}/${groupCount})`)
  }
  const skipped = imageGroupCount - restored
  console.log(`  ✅ groups ${restoredGroups}개, image_groups ${restored}개 복원${skipped > 0 ? ` (고아 행 ${skipped}개 제외)` : ''}`)
}

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 036_scope_group_name_uniqueness_to_parent.ts')

  if (!hasTable(db, 'groups') || !hasTable(db, 'image_groups')) {
    console.log('ℹ️  groups 테이블이 없는 데이터베이스입니다. 건너뜁니다.')
    return
  }

  if (hasGlobalNameUnique(db)) {
    rebuildGroupsWithoutGlobalUnique(db)
  }

  const renamed = resolveCaseInsensitiveSiblingConflicts(db)
  for (const entry of renamed) {
    console.warn(`  ⚠️  같은 위치에 대소문자만 다른 그룹 이름이 있어 변경했습니다: [${entry.id}] "${entry.from}" → "${entry.to}"`)
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${GROUP_PARENT_NAME_UNIQUE_INDEX}
    ON groups(COALESCE(parent_id, 0), name COLLATE NOCASE)
  `)

  const violations = db.prepare("PRAGMA foreign_key_check('image_groups')").all()
  if (violations.length > 0) {
    throw new Error(`036: image_groups 외래키 위반 ${violations.length}건`)
  }
}

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 036_scope_group_name_uniqueness_to_parent.ts')
  // 전역 UNIQUE 복원은 형제 간 동명 그룹이 생긴 뒤에는 불가능할 수 있어 인덱스만 제거한다.
  db.exec(`DROP INDEX IF EXISTS ${GROUP_PARENT_NAME_UNIQUE_INDEX}`)
}
