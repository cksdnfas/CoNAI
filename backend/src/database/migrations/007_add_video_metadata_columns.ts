import Database from 'better-sqlite3';

/**
 * 마이그레이션: 동영상 메타데이터 컬럼 추가
 * - duration: 동영상 재생 시간 (초)
 * - fps: 프레임 레이트
 * - video_codec: 비디오 코덱
 * - audio_codec: 오디오 코덱
 * - bitrate: 비트레이트 (kbps)
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🎬 Migration 007: 동영상 메타데이터 컬럼 추가 시작...');

  // images 테이블에 동영상 메타데이터 컬럼 추가
  const columns = [
    { name: 'duration', type: 'REAL', comment: '동영상 재생 시간 (초)' },
    { name: 'fps', type: 'REAL', comment: '프레임 레이트' },
    { name: 'video_codec', type: 'VARCHAR(50)', comment: '비디오 코덱' },
    { name: 'audio_codec', type: 'VARCHAR(50)', comment: '오디오 코덱' },
    { name: 'bitrate', type: 'REAL', comment: '비트레이트 (kbps)' }
  ];

  for (const column of columns) {
    try {
      // 컬럼이 이미 존재하는지 확인
      const tableInfo = db.prepare(`PRAGMA table_info(images)`).all() as Array<{ name: string }>;
      const columnExists = tableInfo.some(col => col.name === column.name);

      if (!columnExists) {
        db.exec(`ALTER TABLE images ADD COLUMN ${column.name} ${column.type}`);
        console.log(`  ✅ ${column.name} 컬럼 추가 (${column.comment})`);
      } else {
        console.log(`  ⏭️  ${column.name} 컬럼 이미 존재`);
      }
    } catch (error) {
      console.error(`  ❌ ${column.name} 컬럼 추가 실패:`, error);
      throw error;
    }
  }

  console.log('✅ Migration 007: 동영상 메타데이터 컬럼 추가 완료');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🎬 Migration 007 rollback: 동영상 메타데이터 컬럼 제거 시작...');

  // SQLite는 ALTER TABLE DROP COLUMN을 직접 지원하지 않으므로
  // 테이블 재생성이 필요하지만, 데이터 손실 위험이 있어 경고만 출력
  console.warn('⚠️  SQLite는 컬럼 삭제를 직접 지원하지 않습니다.');
  console.warn('⚠️  동영상 메타데이터 컬럼은 그대로 유지됩니다. (duration, fps, video_codec, audio_codec, bitrate)');
  console.warn('⚠️  필요시 데이터베이스를 백업 후 수동으로 테이블 재생성이 필요합니다.');

  console.log('✅ Migration 007 rollback: 완료 (컬럼 유지)');
};
