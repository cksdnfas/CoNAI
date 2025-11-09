const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'images.db');
const db = new Database(dbPath);

console.log('Checking collection types for "window" group:\n');

const rows = db.prepare(`
  SELECT
    g.name as group_name,
    ig.composite_hash,
    ig.collection_type,
    im.width,
    im.height
  FROM image_groups ig
  JOIN groups g ON ig.group_id = g.id
  LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
  WHERE g.name = 'window'
  LIMIT 10
`).all();

if (rows.length === 0) {
  console.log('No images found in "window" group');
} else {
  console.table(rows);

  const autoCount = rows.filter(r => r.collection_type === 'auto').length;
  const manualCount = rows.filter(r => r.collection_type === 'manual').length;

  console.log(`\nSummary:`);
  console.log(`- Auto collected: ${autoCount}`);
  console.log(`- Manual collected: ${manualCount}`);
}

db.close();
