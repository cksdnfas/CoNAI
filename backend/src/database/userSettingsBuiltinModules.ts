import Database from 'better-sqlite3';

type ExistingBuiltinModuleRow = {
  id: number;
  name: string;
  category?: string | null;
  engine_type: string;
  authoring_source: string;
  internal_fixed_values?: string | null;
  external_key?: string | null;
};

/** Seed built-in system-native workflow modules that should always be available. */
export function ensureBuiltinSystemModules(db: Database.Database): void {
  /** Upsert one built-in module using operation_key as the stable identity. */
  const upsertBuiltinModule = (
    name: string,
    description: string,
    category: string,
    exposedInputs: unknown,
    outputPorts: unknown,
    internalFixedValues: { operation_key: string } & Record<string, unknown>,
    uiSchema: unknown,
    color: string,
    legacyNames: string[] = [],
  ) => {
    const stableExternalKey = internalFixedValues.operation_key;
    const existingRows = db.prepare(`
      SELECT id, name, category, engine_type, authoring_source, internal_fixed_values, external_key
      FROM module_definitions
      WHERE engine_type = 'system' AND authoring_source = 'manual'
    `).all() as ExistingBuiltinModuleRow[];

    const existing = existingRows.find((row) => {
      if (row.external_key === stableExternalKey) {
        return true;
      }

      if (row.internal_fixed_values) {
        try {
          const parsed = JSON.parse(row.internal_fixed_values) as { operation_key?: string };
          if (parsed.operation_key === stableExternalKey) {
            return true;
          }
        } catch {
          // fall through to legacy name-based match
        }
      }

      return row.name === name || legacyNames.includes(row.name);
    });

    if (existing) {
      db.prepare(`
        UPDATE module_definitions
        SET
          name = ?,
          description = ?,
          category = ?,
          template_defaults = ?,
          exposed_inputs = ?,
          output_ports = ?,
          internal_fixed_values = ?,
          ui_schema = ?,
          color = ?,
          external_key = ?,
          updated_date = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        name,
        description,
        category,
        JSON.stringify({}),
        JSON.stringify(exposedInputs),
        JSON.stringify(outputPorts),
        JSON.stringify(internalFixedValues),
        JSON.stringify(uiSchema),
        color,
        stableExternalKey,
        existing.id,
      );
      return;
    }

    db.prepare(`
      INSERT INTO module_definitions (
        name, description, engine_type, authoring_source, category,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color, external_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        engine_type = excluded.engine_type,
        authoring_source = excluded.authoring_source,
        category = excluded.category,
        template_defaults = excluded.template_defaults,
        exposed_inputs = excluded.exposed_inputs,
        output_ports = excluded.output_ports,
        internal_fixed_values = excluded.internal_fixed_values,
        ui_schema = excluded.ui_schema,
        version = excluded.version,
        is_active = excluded.is_active,
        color = excluded.color,
        external_key = excluded.external_key,
        updated_date = CURRENT_TIMESTAMP
    `).run(
      name,
      description,
      'system',
      'manual',
      category,
      JSON.stringify({}),
      JSON.stringify(exposedInputs),
      JSON.stringify(outputPorts),
      JSON.stringify(internalFixedValues),
      JSON.stringify(uiSchema),
      1,
      1,
      color,
      stableExternalKey,
    );
  };

  upsertBuiltinModule(
    '상수 텍스트',
    '노드 안에 넣어둔 텍스트를 그대로 꺼내서 다음 단계로 넘겨줘.',
    'input',
    [
      {
        key: 'text',
        label: '텍스트',
        direction: 'input',
        data_type: 'text',
        required: true,
        multiple: false,
      },
    ],
    [
      {
        key: 'text',
        label: '텍스트',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.constant_text' },
    [
      {
        key: 'text',
        label: '텍스트',
        data_type: 'text',
        placeholder: '텍스트 입력',
      },
    ],
    '#66bb6a',
    ['텍스트'],
  );

  upsertBuiltinModule(
    '상수 프롬프트',
    '노드 안에 넣어둔 텍스트를 그대로 꺼내서 다음 단계로 넘겨줘.',
    'input',
    [
      {
        key: 'prompt',
        label: '텍스트',
        direction: 'input',
        data_type: 'text',
        required: true,
        multiple: false,
      },
    ],
    [
      {
        key: 'prompt',
        label: '텍스트',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.constant_prompt' },
    [
      {
        key: 'prompt',
        label: '텍스트',
        data_type: 'text',
        placeholder: '텍스트 입력',
      },
    ],
    '#66bb6a',
    ['텍스트', '상수 프롬프트'],
  );

  upsertBuiltinModule(
    'JSON',
    '노드 안에 넣어둔 JSON 값을 그대로 꺼내서 다음 단계로 넘겨줘.',
    'input',
    [
      {
        key: 'json',
        label: 'JSON',
        direction: 'input',
        data_type: 'json',
        required: true,
        multiple: false,
      },
    ],
    [
      {
        key: 'json',
        label: 'JSON',
        direction: 'output',
        data_type: 'json',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.constant_json' },
    [
      {
        key: 'json',
        label: 'JSON',
        data_type: 'json',
        placeholder: '{\n  "key": "value"\n}',
      },
    ],
    '#78909c',
  );

  upsertBuiltinModule(
    '이미지',
    '노드 안에 넣어둔 이미지를 그대로 꺼내서 다음 단계로 넘겨줘.',
    'input',
    [
      {
        key: 'image',
        label: '이미지',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
      },
    ],
    [
      {
        key: 'image',
        label: '이미지',
        direction: 'output',
        data_type: 'image',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.constant_image' },
    [],
    '#29b6f6',
  );

  upsertBuiltinModule(
    '숫자',
    '노드 안에 넣어둔 숫자 값을 그대로 꺼내서 다음 단계로 넘겨줘.',
    'input',
    [
      {
        key: 'number',
        label: '숫자',
        direction: 'input',
        data_type: 'number',
        required: true,
        multiple: false,
      },
    ],
    [
      {
        key: 'number',
        label: '숫자',
        direction: 'output',
        data_type: 'number',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.constant_number' },
    [
      {
        key: 'number',
        label: '숫자',
        data_type: 'number',
      },
    ],
    '#ffd54f',
  );

  upsertBuiltinModule(
    '불리언',
    '노드 안에 넣어둔 참/거짓 값을 그대로 꺼내서 다음 단계로 넘겨줘.',
    'input',
    [
      {
        key: 'boolean',
        label: '불리언',
        direction: 'input',
        data_type: 'boolean',
        required: true,
        multiple: false,
      },
    ],
    [
      {
        key: 'boolean',
        label: '불리언',
        direction: 'output',
        data_type: 'boolean',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.constant_boolean' },
    [
      {
        key: 'boolean',
        label: '불리언',
        data_type: 'select',
        options: ['true', 'false'],
      },
    ],
    '#ef9a9a',
  );

  upsertBuiltinModule(
    '텍스트 합치기',
    'A, B, C 텍스트를 순서대로 붙여서 하나의 텍스트로 만들어. A-B와 B-C 사이 구분자는 노드 안에서 바로 바꿀 수 있어.',
    'utility',
    [
      {
        key: 'text_a',
        label: 'A',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: '첫 번째 텍스트 조각이야.',
      },
      {
        key: 'text_b',
        label: 'B',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: '두 번째 텍스트 조각이야.',
      },
      {
        key: 'text_c',
        label: 'C',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: '세 번째 텍스트 조각이야.',
      },
    ],
    [
      {
        key: 'text',
        label: '텍스트',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.merge_text' },
    [
      {
        key: 'separator_ab',
        label: 'A 뒤 문자열',
        data_type: 'text',
        default_value: ',',
        placeholder: '예: , 또는 줄바꿈',
        description: 'A 항목 뒤에 붙일 문자열이야.',
      },
      {
        key: 'separator_bc',
        label: 'B 뒤 문자열',
        data_type: 'text',
        default_value: ',',
        placeholder: '예: , 또는 줄바꿈',
        description: 'B 항목 뒤에 붙일 문자열이야.',
      },
    ],
    '#4db6ac',
  );

  upsertBuiltinModule(
    '그룹 랜덤 프롬프트',
    '저장된 프롬프트 그룹에서 항목 하나를 뽑아 재사용 가능한 워크플로우 텍스트로 꺼내와.',
    'prompt',
    [
      {
        key: 'group_name',
        label: '그룹 이름',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: 'group_id가 없을 때 샘플링할 프롬프트 그룹 이름이야.',
      },
      {
        key: 'group_id',
        label: '그룹 ID',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        description: '프롬프트 그룹 ID야. 값이 있으면 그룹 이름보다 우선해.',
      },
      {
        key: 'type',
        label: '컬렉션 종류',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        default_value: 'positive',
        description: 'positive, negative, auto 중 하나를 사용해.',
      },
      {
        key: 'seed',
        label: '시드',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        description: '선택 결과를 고정하고 싶을 때 쓰는 시드야.',
      },
    ],
    [
      {
        key: 'prompt',
        label: '프롬프트',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'text',
        label: '텍스트',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'entry_json',
        label: '항목 JSON',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.random_prompt_from_group' },
    [
      {
        key: 'group_name',
        label: '그룹 이름',
        data_type: 'text',
        placeholder: '예: 캐릭터 포즈 / 의상 / 자동 태그',
      },
      {
        key: 'group_id',
        label: '그룹 ID',
        data_type: 'number',
      },
      {
        key: 'type',
        label: '컬렉션 종류',
        data_type: 'select',
        default_value: 'positive',
        options: ['positive', 'negative', 'auto'],
      },
      {
        key: 'seed',
        label: '시드',
        data_type: 'number',
      },
    ],
    '#26a69a',
  );

  upsertBuiltinModule(
    '유사 이미지 찾기',
    '입력 이미지 하나를 기준으로 현재 라이브러리에서 비슷한 이미지를 찾아줘.',
    'image',
    [
      {
        key: 'image',
        label: '이미지',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: '유사 이미지 검색 기준으로 사용할 입력 이미지야.',
      },
      {
        key: 'limit',
        label: '개수',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 12,
        description: '반환할 유사 이미지 최대 개수야.',
      },
      {
        key: 'threshold',
        label: '임계값',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 15,
        description: '일치로 볼 수 있는 최대 지각 해시 거리야.',
      },
      {
        key: 'include_prompt',
        label: '프롬프트 포함',
        direction: 'input',
        data_type: 'boolean',
        required: false,
        multiple: false,
        default_value: true,
        description: '각 결과에 프롬프트 메타데이터를 함께 포함할지 정해.',
      },
    ],
    [
      {
        key: 'matches',
        label: '검색 결과',
        direction: 'output',
        data_type: 'json',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.find_similar_images' },
    [
      {
        key: 'limit',
        label: '개수',
        data_type: 'number',
        default_value: 12,
      },
      {
        key: 'threshold',
        label: '임계값',
        data_type: 'number',
        default_value: 15,
      },
      {
        key: 'include_prompt',
        label: '프롬프트 포함',
        data_type: 'checkbox',
        default_value: true,
      },
    ],
    '#42a5f5',
  );

  upsertBuiltinModule(
    '참조에서 프롬프트 불러오기',
    '이미지 참조 정보를 재사용 가능한 프롬프트 텍스트와 메타데이터로 변환해.',
    'prompt',
    [
      {
        key: 'reference',
        label: '참조',
        direction: 'input',
        data_type: 'json',
        required: false,
        multiple: false,
        description: '유사 이미지 찾기 같은 노드가 만든 구조화된 참조 JSON이야.',
      },
      {
        key: 'composite_hash',
        label: '컴포지트 해시',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: '이미지의 직접 컴포지트 해시야. 있으면 참조 JSON보다 우선해.',
      },
      {
        key: 'index',
        label: '인덱스',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 0,
        description: '참조에 items 배열이 있을 때 읽어올 항목 순서야.',
      },
    ],
    [
      {
        key: 'prompt',
        label: '프롬프트',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'text',
        label: '텍스트',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'metadata',
        label: '메타데이터',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.load_prompt_from_reference' },
    [
      {
        key: 'composite_hash',
        label: '컴포지트 해시',
        data_type: 'text',
      },
      {
        key: 'index',
        label: '인덱스',
        data_type: 'number',
        default_value: 0,
      },
    ],
    '#66bb6a',
  );

  upsertBuiltinModule(
    '참조에서 이미지 불러오기',
    '이미지 참조 정보를 실제 그래프 이미지 아티팩트로 불러와.',
    'image',
    [
      {
        key: 'reference',
        label: '참조',
        direction: 'input',
        data_type: 'json',
        required: false,
        multiple: false,
        description: '유사 이미지 찾기 같은 노드가 만든 구조화된 참조 JSON이야.',
      },
      {
        key: 'composite_hash',
        label: '컴포지트 해시',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: '이미지의 직접 컴포지트 해시야. 있으면 참조 JSON보다 우선해.',
      },
      {
        key: 'index',
        label: '인덱스',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 0,
        description: '참조에 items 배열이 있을 때 읽어올 항목 순서야.',
      },
    ],
    [
      {
        key: 'image',
        label: '이미지',
        direction: 'output',
        data_type: 'image',
        required: true,
        multiple: false,
      },
      {
        key: 'image_ref',
        label: '이미지 참조',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.load_image_from_reference' },
    [
      {
        key: 'composite_hash',
        label: '컴포지트 해시',
        data_type: 'text',
      },
      {
        key: 'index',
        label: '인덱스',
        data_type: 'number',
        default_value: 0,
      },
    ],
    '#29b6f6',
  );

  upsertBuiltinModule(
    '라이브러리 랜덤 이미지',
    '현재 라이브러리에서 이미지 하나를 무작위로 골라 재사용 가능한 그래프 이미지로 꺼내와.',
    'image',
    [],
    [
      {
        key: 'image',
        label: '이미지',
        direction: 'output',
        data_type: 'image',
        required: true,
        multiple: false,
      },
      {
        key: 'image_ref',
        label: '이미지 참조',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
      {
        key: 'metadata',
        label: '메타데이터',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.random_image_from_library' },
    [],
    '#7e57c2',
  );

  upsertBuiltinModule(
    '이미지에서 태그 추출',
    '설정된 이미지 태거를 실행해서 프롬프트에 쓰기 좋은 태그를 추출해.',
    'analysis',
    [
      {
        key: 'image',
        label: '이미지',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: '태그를 추출할 입력 이미지야.',
      },
    ],
    [
      {
        key: 'tags_text',
        label: '태그 텍스트',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'tags_prompt',
        label: '태그 프롬프트',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'tags_json',
        label: '태그 JSON',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.extract_tags_from_image' },
    [],
    '#ab47bc',
  );

  upsertBuiltinModule(
    '최종 결과',
    '업스트림 결과물 하나를 복제 없이 워크플로우의 최종 결과로 확정해.',
    'output',
    [
      {
        key: 'value',
        label: '값',
        direction: 'input',
        data_type: 'any',
        required: true,
        multiple: false,
        description: '최종 워크플로우 결과로 기록할 업스트림 결과물 하나를 연결해.',
      },
    ],
    [],
    { operation_key: 'system.final_result' },
    [],
    '#ffa726',
  );

  upsertBuiltinModule(
    '텍스트 변환',
    '텍스트, 프롬프트, JSON 같은 입력을 문자열로 정규화한 뒤 정규식 추출/치환과 접두어·접미어 조합으로 후처리해.',
    'utility',
    [
      {
        key: 'value',
        label: '값',
        direction: 'input',
        data_type: 'any',
        required: true,
        multiple: false,
        description: '텍스트, 프롬프트, JSON, 숫자 같은 업스트림 값을 문자열로 바꿔서 처리해.',
      },
    ],
    [
      {
        key: 'text',
        label: '변환 텍스트',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.regex_text_transform' },
    [
      {
        key: 'mode',
        label: '변환 방식',
        data_type: 'select',
        default_value: 'extract',
        options: ['extract', 'replace'],
      },
      {
        key: 'pattern',
        label: '정규식',
        data_type: 'text',
        placeholder: '예: ^\s*([^,\n]+)',
      },
      {
        key: 'flags',
        label: '플래그',
        data_type: 'text',
        placeholder: '예: i 또는 gm',
      },
      {
        key: 'replacement',
        label: '치환 문자열',
        data_type: 'text',
        placeholder: '예: @$1,',
      },
      {
        key: 'group_index',
        label: '추출 그룹 번호',
        data_type: 'number',
      },
      {
        key: 'prefix',
        label: '접두어',
        data_type: 'text',
        placeholder: '예: @',
      },
      {
        key: 'suffix',
        label: '접미어',
        data_type: 'text',
        placeholder: '예: ,',
      },
    ],
    '#8d6e63',
  );

  upsertBuiltinModule(
    '이미지에서 작가 추출',
    '설정된 Kaloscope 작가 태거를 실행해서 작가나 스타일 힌트를 추출해.',
    'analysis',
    [
      {
        key: 'image',
        label: '이미지',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: '작가나 스타일을 추출할 입력 이미지야.',
      },
    ],
    [
      {
        key: 'artist_text',
        label: '작가 텍스트',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'artist_prompt',
        label: '작가 프롬프트',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'artist_json',
        label: '작가 JSON',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.extract_artist_from_image' },
    [],
    '#ef5350',
  );
}
