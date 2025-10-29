import Database from 'better-sqlite3';
import path from 'path';
import { toRelativePath } from '../../utils/pathResolver';

/**
 * Migration 002: 기본 폴더를 상대 경로로 저장
 * - 포터블 이동 시에도 자동으로 올바른 경로 적용
 * - 절대 경로를 상대 경로로 변환하여 이식성 확보
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔍 Migration 002: 기본 폴더를 상대 경로로 변환 시작...');

  // 1. 현재 등록된 기본 폴더 확인
  const existingFolder = db.prepare(`
    SELECT id, folder_path FROM watched_folders
    WHERE folder_type = 'upload'
    ORDER BY id ASC
    LIMIT 1
  `).get() as { id: number; folder_path: string } | undefined;

  if (!existingFolder) {
    console.log('  ℹ️  기본 폴더가 없습니다. 새로 생성합니다.');

    // 기본 폴더가 없으면 상대 경로로 생성
    const relativePath = path.join('uploads', 'images');
    db.prepare(`
      INSERT INTO watched_folders (folder_path, folder_name, folder_type, is_active)
      VALUES (?, ?, ?, ?)
    `).run(relativePath, '직접 업로드', 'upload', 1);

    console.log(`  ✅ 기본 폴더 생성: ${relativePath} (상대 경로)`);
  } else {
    // 기존 폴더 경로를 상대 경로로 변환
    console.log(`  🔄 기존 경로: ${existingFolder.folder_path}`);

    // 절대 경로를 상대 경로로 변환
    const relativePath = toRelativePath(existingFolder.folder_path);

    // 이미 상대 경로면 스킵
    if (!path.isAbsolute(existingFolder.folder_path)) {
      console.log(`  ℹ️  이미 상대 경로로 설정되어 있습니다: ${existingFolder.folder_path}`);
      return;
    }

    console.log(`  🔄 새 경로: ${relativePath} (상대 경로)`);

    db.prepare(`
      UPDATE watched_folders
      SET folder_path = ?
      WHERE id = ?
    `).run(relativePath, existingFolder.id);

    console.log('  ✅ 기본 폴더 경로를 상대 경로로 변환 완료');
  }

  console.log('✅ Migration 002: 기본 폴더를 상대 경로로 변환 완료');
  console.log('   💡 포터블을 이동해도 자동으로 올바른 경로가 적용됩니다!');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔍 Migration 002 rollback: 기본 폴더 경로 복원 시작...');

  // Rollback: 절대 경로를 상대 경로로 복원 (선택적)
  const folder = db.prepare(`
    SELECT id, folder_path FROM watched_folders
    WHERE folder_type = 'upload'
    ORDER BY id ASC
    LIMIT 1
  `).get() as { id: number; folder_path: string } | undefined;

  if (folder && path.isAbsolute(folder.folder_path)) {
    db.prepare(`
      UPDATE watched_folders
      SET folder_path = ?
      WHERE id = ?
    `).run('uploads/images', folder.id);

    console.log('  ✅ 기본 폴더 경로를 상대 경로로 복원');
  }

  console.log('✅ Migration 002 rollback: 완료');
};
