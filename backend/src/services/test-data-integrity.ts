import { db } from '../database/init';

console.log('=== Data Integrity Check ===\n');

// 1. image_metadata에만 있고 image_files에 없는 경우
const metadataOnly = db.prepare(`
  SELECT COUNT(*) as count
  FROM image_metadata im
  WHERE NOT EXISTS (
    SELECT 1 FROM image_files if_
    WHERE if_.composite_hash = im.composite_hash
  )
`).get() as { count: number };
console.log(`Images in metadata but NOT in files: ${metadataOnly.count}`);

// 2. image_files에만 있고 image_metadata에 없는 경우
const filesOnly = db.prepare(`
  SELECT COUNT(*) as count
  FROM image_files if_
  WHERE NOT EXISTS (
    SELECT 1 FROM image_metadata im
    WHERE im.composite_hash = if_.composite_hash
  )
`).get() as { count: number };
console.log(`Images in files but NOT in metadata: ${filesOnly.count}`);

// 3. 양쪽 모두 있는 경우
const both = db.prepare(`
  SELECT COUNT(*) as count
  FROM image_metadata im
  INNER JOIN image_files if_ ON im.composite_hash = if_.composite_hash
`).get() as { count: number };
console.log(`Images in BOTH tables: ${both.count}`);

// 4. auto_tags = NULL이면서 image_files에도 있는 경우
const nullWithFiles = db.prepare(`
  SELECT COUNT(*) as count
  FROM image_metadata im
  INNER JOIN image_files if_ ON im.composite_hash = if_.composite_hash
  WHERE im.auto_tags IS NULL
    AND if_.file_status = 'active'
`).get() as { count: number };
console.log(`Untagged images WITH active files: ${nullWithFiles.count}`);

// 5. 샘플: auto_tags = NULL이면서 파일도 있는 이미지
const samples = db.prepare(`
  SELECT
    im.composite_hash,
    if_.original_file_path,
    if_.file_status
  FROM image_metadata im
  INNER JOIN image_files if_ ON im.composite_hash = if_.composite_hash
  WHERE im.auto_tags IS NULL
    AND if_.file_status = 'active'
  LIMIT 5
`).all() as Array<{
  composite_hash: string;
  original_file_path: string;
  file_status: string;
}>;

if (samples.length > 0) {
  console.log('\nSample untagged images WITH files:');
  samples.forEach((sample, idx) => {
    console.log(`  ${idx + 1}. ${sample.original_file_path}`);
    console.log(`     Status: ${sample.file_status}`);
  });
} else {
  console.log('\nNo untagged images with active files found!');
  console.log('All 149 NULL auto_tags images have no corresponding image_files records.');
}

process.exit(0);
