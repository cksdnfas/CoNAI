/**
 * 동적 UPDATE 쿼리 빌더 유틸리티
 * 여러 모델에서 반복되는 동적 UPDATE 로직을 중앙화
 */

export interface UpdateQueryResult {
  sql: string;
  values: any[];
}

/**
 * SQL 리터럴 타입
 * CURRENT_TIMESTAMP, NOW() 등 SQL 함수를 나타내는 특수 타입
 */
export interface SqlLiteral {
  __sqlLiteral: true;
  value: string;
}

/**
 * SQL 리터럴 생성 헬퍼
 * CURRENT_TIMESTAMP, NOW() 등 SQL 함수를 사용할 때 사용
 *
 * @example
 * ```typescript
 * const updates = {
 *   name: 'New Name',
 *   updated_date: sqlLiteral('CURRENT_TIMESTAMP')
 * };
 * ```
 */
export function sqlLiteral(value: string): SqlLiteral {
  return { __sqlLiteral: true, value };
}

/**
 * 값이 SQL 리터럴인지 확인
 */
function isSqlLiteral(value: any): value is SqlLiteral {
  return value && typeof value === 'object' && value.__sqlLiteral === true;
}

/**
 * 동적 UPDATE 쿼리 빌더
 *
 * @param table - 테이블 명
 * @param updates - 업데이트할 필드 { fieldName: value }
 * @param where - WHERE 조건 { fieldName: value }
 * @returns SQL 문자열과 바인딩 값
 *
 * @example
 * ```typescript
 * const { sql, values } = buildUpdateQuery(
 *   'groups',
 *   { name: 'New Name', updated_date: sqlLiteral('CURRENT_TIMESTAMP') },
 *   { id: 123 }
 * );
 * // sql: "UPDATE groups SET name = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?"
 * // values: ['New Name', 123]
 * ```
 */
export function buildUpdateQuery(
  table: string,
  updates: Record<string, any>,
  where: Record<string, any>
): UpdateQueryResult {
  const fields: string[] = [];
  const values: any[] = [];

  // SET 절 생성 - undefined 값은 제외
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      if (isSqlLiteral(value)) {
        // SQL 리터럴은 직접 삽입
        fields.push(`${key} = ${value.value}`);
      } else {
        // 일반 값은 파라미터 바인딩
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
  });

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  // WHERE 절 생성
  const whereFields: string[] = [];
  Object.entries(where).forEach(([key, value]) => {
    whereFields.push(`${key} = ?`);
    values.push(value);
  });

  if (whereFields.length === 0) {
    throw new Error('WHERE clause is required for UPDATE queries');
  }

  const sql = `UPDATE ${table} SET ${fields.join(', ')} WHERE ${whereFields.join(' AND ')}`;

  return { sql, values };
}

/**
 * Named 파라미터 방식의 동적 UPDATE 쿼리 빌더
 * better-sqlite3의 named parameter 방식을 사용
 *
 * @param table - 테이블 명
 * @param updates - 업데이트할 필드 { fieldName: value }
 * @param where - WHERE 조건 { fieldName: value }
 * @returns SQL 문자열과 바인딩 객체
 *
 * @example
 * ```typescript
 * const { sql, values } = buildUpdateQueryNamed(
 *   'groups',
 *   { name: 'New Name', description: 'Updated' },
 *   { id: 123 }
 * );
 * // sql: "UPDATE groups SET name = @name, description = @description WHERE id = @id"
 * // values: { name: 'New Name', description: 'Updated', id: 123 }
 * ```
 */
export function buildUpdateQueryNamed(
  table: string,
  updates: Record<string, any>,
  where: Record<string, any>
): { sql: string; values: Record<string, any> } {
  const fields: string[] = [];
  const values: Record<string, any> = {};

  // SET 절 생성 - undefined 값은 제외
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = value;
    }
  });

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  // WHERE 절 생성
  const whereFields: string[] = [];
  Object.entries(where).forEach(([key, value]) => {
    // WHERE 절 파라미터 이름 충돌 방지
    const whereKey = `where_${key}`;
    whereFields.push(`${key} = @${whereKey}`);
    values[whereKey] = value;
  });

  if (whereFields.length === 0) {
    throw new Error('WHERE clause is required for UPDATE queries');
  }

  const sql = `UPDATE ${table} SET ${fields.join(', ')} WHERE ${whereFields.join(' AND ')}`;

  return { sql, values };
}

/**
 * 객체에서 undefined 값을 필터링
 * UPDATE 작업 전에 undefined 값을 제거하는 헬퍼 함수
 *
 * @param obj - 필터링할 객체
 * @returns undefined가 제거된 새 객체
 *
 * @example
 * ```typescript
 * const filtered = filterDefined({ name: 'Test', desc: undefined, id: 123 });
 * // { name: 'Test', id: 123 }
 * ```
 */
export function filterDefined<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  ) as Partial<T>;
}

/**
 * 타임스탬프 필드 자동 추가
 * UPDATE 쿼리에 updated_at 또는 metadata_updated_date 필드를 자동으로 추가
 *
 * @param updates - 원본 업데이트 객체
 * @param timestampField - 타임스탬프 필드 이름 (기본값: 'updated_at')
 * @returns 타임스탬프가 추가된 업데이트 객체
 */
export function addTimestamp(
  updates: Record<string, any>,
  timestampField: string = 'updated_at'
): Record<string, any> {
  return {
    ...updates,
    [timestampField]: new Date().toISOString(),
  };
}
