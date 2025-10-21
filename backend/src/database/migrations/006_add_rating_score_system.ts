import Database from 'better-sqlite3';

/**
 * 마이그레이션: Rating 가중치 점수 시스템 추가
 * - rating_weights: 각 rating 항목별 가중치 설정
 * - rating_tiers: 점수 구간별 등급 분류
 */
export const up = async (db: Database.Database): Promise<void> => {
  // 1. rating_weights 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS rating_weights (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      general_weight REAL NOT NULL DEFAULT 1,
      sensitive_weight REAL NOT NULL DEFAULT 5,
      questionable_weight REAL NOT NULL DEFAULT 15,
      explicit_weight REAL NOT NULL DEFAULT 50,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ rating_weights 테이블 생성 완료');

  // 2. rating_weights 기본값 삽입
  db.prepare(`
    INSERT INTO rating_weights (id, general_weight, sensitive_weight, questionable_weight, explicit_weight)
    VALUES (1, 1, 5, 15, 50)
  `).run();
  console.log('✅ rating_weights 기본값 삽입 완료');

  // 3. rating_tiers 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS rating_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tier_name VARCHAR(50) NOT NULL,
      min_score REAL NOT NULL,
      max_score REAL,
      tier_order INTEGER NOT NULL,
      color VARCHAR(20),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tier_order)
    )
  `);
  console.log('✅ rating_tiers 테이블 생성 완료');

  // 4. rating_tiers 기본값 삽입 (4개 등급)
  const defaultTiers = [
    { tier_name: 'G', min_score: 0, max_score: 2, tier_order: 1, color: '#22c55e' },
    { tier_name: 'Teen', min_score: 2, max_score: 6, tier_order: 2, color: '#3b82f6' },
    { tier_name: 'SFW', min_score: 6, max_score: 15, tier_order: 3, color: '#f59e0b' },
    { tier_name: 'NSFW', min_score: 15, max_score: null, tier_order: 4, color: '#ef4444' }
  ];

  const insertStmt = db.prepare(`
    INSERT INTO rating_tiers (tier_name, min_score, max_score, tier_order, color)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const tier of defaultTiers) {
    insertStmt.run(tier.tier_name, tier.min_score, tier.max_score, tier.tier_order, tier.color);
  }
  console.log(`✅ rating_tiers 기본값 ${defaultTiers.length}개 삽입 완료`);
  console.log('✅ Migration 006: Rating 점수 시스템 추가 완료');
};

export const down = async (db: Database.Database): Promise<void> => {
  db.exec('DROP TABLE IF EXISTS rating_tiers');
  console.log('✅ rating_tiers 테이블 삭제');

  db.exec('DROP TABLE IF EXISTS rating_weights');
  console.log('✅ rating_weights 테이블 삭제');
  console.log('✅ Migration 006 rollback: Rating 점수 시스템 제거 완료');
};
