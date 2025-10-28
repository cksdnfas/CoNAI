-- Wildcard 테이블 생성
-- 와일드카드는 __name__ 형식으로 프롬프트에서 사용됨
-- 하나의 와일드카드가 ComfyUI와 NAI 각각의 항목을 가짐
CREATE TABLE IF NOT EXISTS wildcards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,          -- 와일드카드 이름 (예: 꽃, 시듦꽃 등, __ 제외)
  description TEXT,                   -- 선택적 설명
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Wildcard 항목 테이블
-- 각 와일드카드는 도구별로 여러 개의 항목을 가질 수 있음
-- 각 항목은 쉼표로 구분된 단어들을 포함할 수 있음
CREATE TABLE IF NOT EXISTS wildcard_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wildcard_id INTEGER NOT NULL,
  tool TEXT NOT NULL,                 -- 'comfyui' | 'nai' - 이 항목이 사용될 도구
  content TEXT NOT NULL,              -- 항목 내용 (쉼표로 구분된 단어들, 중첩 와일드카드 포함 가능)
  order_index INTEGER NOT NULL,       -- 정렬 순서 (도구 내에서)
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wildcard_id) REFERENCES wildcards(id) ON DELETE CASCADE
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_wildcards_name ON wildcards(name);
CREATE INDEX IF NOT EXISTS idx_wildcard_items_wildcard_id ON wildcard_items(wildcard_id);
CREATE INDEX IF NOT EXISTS idx_wildcard_items_tool ON wildcard_items(tool);
CREATE INDEX IF NOT EXISTS idx_wildcard_items_wildcard_tool ON wildcard_items(wildcard_id, tool);
CREATE INDEX IF NOT EXISTS idx_wildcard_items_order ON wildcard_items(wildcard_id, tool, order_index);
