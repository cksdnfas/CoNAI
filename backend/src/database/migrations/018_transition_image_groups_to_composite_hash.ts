import Database from 'better-sqlite3';

/**
 * Migration 018: image_groups 테이블을 composite_hash 기반으로 전환
 *
 * 목적:
 * - images.id 참조 제거
 * - image_metadata.composite_hash 참조로 변경
 * - 영구적인 메타데이터 기반 그룹 관계 구축
 *
 * 변경사항:
 * - image_groups.image_id → image_groups.composite_hash
 * - FOREIGN KEY: image_metadata(composite_hash)
 * - UNIQUE 제약: (group_id, composite_hash)
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Migration 018: image_groups → composite_hash 전환 시작...');

  try {
    // 1. composite_hash 컬럼 추가
    console.log('  📝 Step 1: composite_hash 컬럼 추가...');
    db.exec(`ALTER TABLE image_groups ADD COLUMN composite_hash TEXT`);
    console.log('  ✅ composite_hash 컬럼 추가 완료');

    // 2. 기존 image_id → composite_hash 데이터 매핑
    console.log('  🔄 Step 2: 데이터 매핑 중...');
    console.log('     (images.id → image_files → composite_hash)');

    const mappingResult = db.prepare(`
      UPDATE image_groups
      SET composite_hash = (
        SELECT if.composite_hash
        FROM image_files if
        JOIN images i ON if.original_file_path LIKE '%' || i.file_path
        WHERE i.id = image_groups.image_id
        LIMIT 1
      )
      WHERE image_id IS NOT NULL
    `).run();

    console.log(`  ✅ ${mappingResult.changes}개 레코드 매핑 완료`);

    // 3. 매핑 실패 레코드 확인
    const failedRows = db.prepare(`
      SELECT COUNT(*) as count
      FROM image_groups
      WHERE image_id IS NOT NULL AND composite_hash IS NULL
    `).get() as { count: number };

    if (failedRows.count > 0) {
      console.warn(`  ⚠️  ${failedRows.count}개 레코드 매핑 실패 (원본 파일 없음)`);
      console.warn(`     해당 레코드는 새 테이블에서 제외됩니다.`);
    }

    // 4. 매핑된 데이터 검증
    const mappedCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM image_groups
      WHERE composite_hash IS NOT NULL
    `).get() as { count: number };

    console.log(`  📊 매핑 통계: ${mappedCount.count}개 성공, ${failedRows.count}개 실패`);

    // 5. 테이블 재생성 (composite_hash FK 설정, image_id 제거)
    console.log('  🔧 Step 3: 테이블 구조 재구성 중...');

    db.exec(`
      -- 새 테이블 생성
      CREATE TABLE image_groups_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        composite_hash TEXT NOT NULL,
        collection_type TEXT DEFAULT 'manual',
        added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        order_index INTEGER DEFAULT 0,

        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (composite_hash) REFERENCES image_metadata(composite_hash) ON DELETE CASCADE,
        UNIQUE(group_id, composite_hash)
      );

      -- 데이터 이전 (composite_hash가 있는 것만)
      INSERT INTO image_groups_new
        (id, group_id, composite_hash, collection_type, added_date, order_index)
      SELECT id, group_id, composite_hash, collection_type, added_date, order_index
      FROM image_groups
      WHERE composite_hash IS NOT NULL;

      -- 기존 테이블 제거 및 이름 변경
      DROP TABLE image_groups;
      ALTER TABLE image_groups_new RENAME TO image_groups;
    `);
    console.log('  ✅ 테이블 구조 재구성 완료');

    // 6. 인덱스 생성
    console.log('  🔍 Step 4: 인덱스 생성 중...');
    const indexes = [
      { name: 'idx_image_groups_group_id', column: 'group_id' },
      { name: 'idx_image_groups_composite_hash', column: 'composite_hash' },
      { name: 'idx_image_groups_added_date', column: 'added_date' },
      { name: 'idx_image_groups_order', column: 'order_index' },
      { name: 'idx_image_groups_collection_type', column: 'collection_type' }
    ];

    for (const idx of indexes) {
      db.exec(`CREATE INDEX IF NOT EXISTS ${idx.name} ON image_groups(${idx.column})`);
      console.log(`  ✅ ${idx.name} 생성`);
    }

    // 7. 최종 검증
    console.log('  🔍 Step 5: 최종 검증 중...');
    const finalCount = db.prepare('SELECT COUNT(*) as count FROM image_groups').get() as { count: number };
    const groupCount = db.prepare('SELECT COUNT(*) as count FROM groups').get() as { count: number };

    console.log(`  📊 최종 통계:`);
    console.log(`     - image_groups 레코드: ${finalCount.count}개`);
    console.log(`     - groups: ${groupCount.count}개`);

    // 8. 샘플 데이터 확인
    const sampleData = db.prepare(`
      SELECT ig.id, ig.group_id, ig.composite_hash, g.name as group_name
      FROM image_groups ig
      JOIN groups g ON ig.group_id = g.id
      LIMIT 3
    `).all();

    if (sampleData.length > 0) {
      console.log(`  📝 샘플 데이터 (처음 3개):`);
      sampleData.forEach((row: any) => {
        console.log(`     - Group "${row.group_name}" (ID: ${row.group_id}): ${row.composite_hash.substring(0, 16)}...`);
      });
    }

    console.log('✅ Migration 018 완료!');
    console.log('');
    console.log('🎉 image_groups 테이블이 composite_hash 기반으로 전환되었습니다.');
    console.log('   - 이제 images 테이블 없이도 그룹 기능이 작동합니다.');
    console.log('   - 파일 위치 변경에도 그룹 관계가 유지됩니다.');

  } catch (error) {
    console.error('❌ Migration 018 실패:', error);
    throw error;
  }
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Migration 018 rollback: image_groups 복원 시작...');

  try {
    // 원래 구조로 복원 (image_id 기반)
    db.exec(`
      -- 기존 테이블 백업
      ALTER TABLE image_groups RENAME TO image_groups_backup;

      -- 원래 구조 생성
      CREATE TABLE image_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        image_id INTEGER NOT NULL,
        collection_type TEXT DEFAULT 'manual',
        added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        order_index INTEGER DEFAULT 0,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
        UNIQUE(group_id, image_id)
      );

      -- 인덱스 재생성
      CREATE INDEX idx_image_groups_group_id ON image_groups(group_id);
      CREATE INDEX idx_image_groups_image_id ON image_groups(image_id);
      CREATE INDEX idx_image_groups_added_date ON image_groups(added_date);
      CREATE INDEX idx_image_groups_order ON image_groups(order_index);
    `);

    console.warn('⚠️  주의: composite_hash → image_id 역매핑은 자동으로 불가능합니다.');
    console.warn('   백업 데이터베이스에서 복원이 필요합니다.');
    console.warn('   image_groups_backup 테이블을 수동으로 확인하세요.');

    console.log('✅ Migration 018 rollback 완료 (구조만 복원됨)');

  } catch (error) {
    console.error('❌ Migration 018 rollback 실패:', error);
    throw error;
  }
};
