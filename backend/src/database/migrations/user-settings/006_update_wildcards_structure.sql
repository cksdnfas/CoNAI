-- 와일드카드 구조 업데이트: 도구별 항목 지원
-- wildcards 테이블에서 tool 컬럼 제거
-- wildcard_items 테이블에 tool 컬럼 추가

-- 기존 데이터 백업
CREATE TABLE IF NOT EXISTS wildcards_backup AS SELECT * FROM wildcards;
CREATE TABLE IF NOT EXISTS wildcard_items_backup AS SELECT * FROM wildcard_items;

-- 기존 테이블 삭제
DROP TABLE IF EXISTS wildcard_items;
DROP TABLE IF EXISTS wildcards;

-- 새 스키마로 wildcards 테이블 재생성
CREATE TABLE wildcards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 새 스키마로 wildcard_items 테이블 재생성
CREATE TABLE wildcard_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wildcard_id INTEGER NOT NULL,
  tool TEXT NOT NULL,
  content TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wildcard_id) REFERENCES wildcards(id) ON DELETE CASCADE
);

-- 인덱스 재생성
CREATE INDEX idx_wildcards_name ON wildcards(name);
CREATE INDEX idx_wildcard_items_wildcard_id ON wildcard_items(wildcard_id);
CREATE INDEX idx_wildcard_items_tool ON wildcard_items(tool);
CREATE INDEX idx_wildcard_items_wildcard_tool ON wildcard_items(wildcard_id, tool);
CREATE INDEX idx_wildcard_items_order ON wildcard_items(wildcard_id, tool, order_index);

-- 기존 데이터 복원 (데이터가 있다면)
-- wildcards 테이블: tool 컬럼 제외하고 복원
INSERT INTO wildcards (id, name, description, created_date, updated_date)
SELECT id, name, description, created_date, updated_date
FROM wildcards_backup
WHERE EXISTS (SELECT 1 FROM wildcards_backup LIMIT 1);

-- wildcard_items 테이블: 기존 항목들을 'comfyui'로 기본 설정하여 복원
-- (사용자가 나중에 수동으로 NAI용 항목을 추가할 수 있음)
INSERT INTO wildcard_items (id, wildcard_id, tool, content, order_index, created_date)
SELECT id, wildcard_id, 'comfyui', content, order_index, created_date
FROM wildcard_items_backup
WHERE EXISTS (SELECT 1 FROM wildcard_items_backup LIMIT 1);

-- 백업 테이블 삭제
DROP TABLE IF EXISTS wildcards_backup;
DROP TABLE IF EXISTS wildcard_items_backup;
