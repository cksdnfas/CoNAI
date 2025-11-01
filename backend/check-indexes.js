const db = require('better-sqlite3')('database/images.db');

console.log('\n📊 현재 데이터베이스 인덱스 목록:\n');

const indexes = db.prepare(`
  SELECT name, sql
  FROM sqlite_master
  WHERE type='index'
    AND tbl_name IN ('image_files', 'image_metadata', 'image_groups')
    AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all();

indexes.forEach(idx => {
  console.log(`✓ ${idx.name}`);
  if (idx.sql) {
    console.log(`  ${idx.sql}\n`);
  }
});

console.log(`\n총 ${indexes.length}개의 인덱스가 생성되었습니다.\n`);

db.close();
