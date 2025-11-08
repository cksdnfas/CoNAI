const db = require('better-sqlite3')('backend/database/images.db');

const query = `
  SELECT
    if.id as file_id,
    if.mime_type,
    if.file_hash,
    mm.composite_hash
  FROM image_files if
  LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
  WHERE if.file_status = 'active' AND if.mime_type LIKE 'video/%'
  LIMIT 1
`;

const result = db.prepare(query).get();
console.log(JSON.stringify(result, null, 2));
db.close();
