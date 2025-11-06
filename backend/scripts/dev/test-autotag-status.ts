import { db } from '../../src/database/init';
import { autoTagScheduler } from '../../src/services/autoTagScheduler';

console.log('=== Auto-Tag Status Check ===\n');

// 1. 전체 이미지 개수
const totalImages = db.prepare(`
  SELECT COUNT(*) as count FROM image_metadata
`).get() as { count: number };
console.log(`Total images: ${totalImages.count}`);

// 2. auto_tags가 NULL인 이미지
const nullTags = db.prepare(`
  SELECT COUNT(*) as count
  FROM image_metadata
  WHERE auto_tags IS NULL
`).get() as { count: number };
console.log(`Images with NULL auto_tags: ${nullTags.count}`);

// 3. auto_tags가 설정된 이미지
const withTags = db.prepare(`
  SELECT COUNT(*) as count
  FROM image_metadata
  WHERE auto_tags IS NOT NULL
`).get() as { count: number };
console.log(`Images with auto_tags: ${withTags.count}`);

// 4. active 파일과 조인한 미태깅 이미지
const activeUntagged = db.prepare(`
  SELECT COUNT(*) as count
  FROM image_metadata im
  JOIN image_files if_ ON im.composite_hash = if_.composite_hash
  WHERE im.auto_tags IS NULL
    AND if_.file_status = 'active'
`).get() as { count: number };
console.log(`Active untagged images (scheduler query): ${activeUntagged.count}`);

// 5. 스케줄러 상태
const schedulerStatus = autoTagScheduler.getStatus();
console.log('\nScheduler Status:');
console.log(`  Running: ${schedulerStatus.isRunning}`);
console.log(`  Untagged Count: ${schedulerStatus.untaggedCount}`);
console.log(`  Polling Interval: ${schedulerStatus.pollingIntervalSeconds}s`);
console.log(`  Batch Size: ${schedulerStatus.batchSize}`);

// 6. 샘플 데이터 (처음 5개)
const samples = db.prepare(`
  SELECT
    im.composite_hash,
    im.auto_tags,
    if_.original_file_path,
    if_.file_status
  FROM image_metadata im
  LEFT JOIN image_files if_ ON im.composite_hash = if_.composite_hash
  WHERE im.auto_tags IS NULL
  LIMIT 5
`).all() as Array<{
  composite_hash: string;
  auto_tags: string | null;
  original_file_path: string;
  file_status: string;
}>;

if (samples.length > 0) {
  console.log('\nSample untagged images:');
  samples.forEach((sample, idx) => {
    console.log(`  ${idx + 1}. ${sample.original_file_path || 'No file path'}`);
    console.log(`     Hash: ${sample.composite_hash}`);
    console.log(`     Status: ${sample.file_status || 'No file'}`);
  });
} else {
  console.log('\nNo untagged images found!');
}

process.exit(0);
