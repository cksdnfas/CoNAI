import Database from 'better-sqlite3';

/** Seed built-in system-native workflow modules that should always be available. */
export function ensureBuiltinSystemModules(db: Database.Database): void {
  const insertIfMissing = (
    name: string,
    description: string,
    category: string,
    exposedInputs: unknown,
    outputPorts: unknown,
    internalFixedValues: unknown,
    uiSchema: unknown,
    color: string,
  ) => {
    const existing = db
      .prepare('SELECT id, category, engine_type, authoring_source FROM module_definitions WHERE name = ?')
      .get(name) as { id: number; category?: string | null; engine_type: string; authoring_source: string } | undefined;

    if (existing) {
      if (existing.engine_type === 'system' && existing.authoring_source === 'manual' && existing.category !== category) {
        db
          .prepare('UPDATE module_definitions SET category = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?')
          .run(category, existing.id);
      }
      return;
    }

    db.prepare(`
      INSERT INTO module_definitions (
        name, description, engine_type, authoring_source, category,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );
  };

  insertIfMissing(
    'Constant Text',
    'Output one fixed text value directly from the graph without requiring workflow-run exposed inputs.',
    'input',
    [
      {
        key: 'text',
        label: 'Text',
        direction: 'input',
        data_type: 'text',
        required: true,
        multiple: false,
        description: 'Fixed text value stored on the node itself.',
      },
    ],
    [
      {
        key: 'text',
        label: 'Text',
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
        label: 'Text',
        data_type: 'text',
        placeholder: '고정 텍스트 입력',
      },
    ],
    '#66bb6a',
  );

  insertIfMissing(
    'Constant Prompt',
    'Output one fixed prompt string directly from the graph without requiring workflow-run exposed inputs.',
    'input',
    [
      {
        key: 'prompt',
        label: 'Prompt',
        direction: 'input',
        data_type: 'prompt',
        required: true,
        multiple: false,
        description: 'Fixed prompt value stored on the node itself.',
      },
    ],
    [
      {
        key: 'prompt',
        label: 'Prompt',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.constant_prompt' },
    [
      {
        key: 'prompt',
        label: 'Prompt',
        data_type: 'text',
        placeholder: '고정 프롬프트 입력',
      },
    ],
    '#8e24aa',
  );

  insertIfMissing(
    'Constant JSON',
    'Output one fixed JSON value directly from the graph without requiring workflow-run exposed inputs.',
    'input',
    [
      {
        key: 'json',
        label: 'JSON',
        direction: 'input',
        data_type: 'json',
        required: true,
        multiple: false,
        description: 'Fixed JSON value stored on the node itself.',
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

  insertIfMissing(
    'Constant Image',
    'Output one fixed image value directly from the graph without requiring workflow-run exposed inputs.',
    'input',
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: 'Fixed image value stored on the node itself.',
      },
    ],
    [
      {
        key: 'image',
        label: 'Image',
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

  insertIfMissing(
    'Constant Number',
    'Output one fixed number value directly from the graph without requiring workflow-run exposed inputs.',
    'input',
    [
      {
        key: 'number',
        label: 'Number',
        direction: 'input',
        data_type: 'number',
        required: true,
        multiple: false,
        description: 'Fixed number value stored on the node itself.',
      },
    ],
    [
      {
        key: 'number',
        label: 'Number',
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
        label: 'Number',
        data_type: 'number',
      },
    ],
    '#ffd54f',
  );

  insertIfMissing(
    'Constant Boolean',
    'Output one fixed boolean value directly from the graph without requiring workflow-run exposed inputs.',
    'input',
    [
      {
        key: 'boolean',
        label: 'Boolean',
        direction: 'input',
        data_type: 'boolean',
        required: true,
        multiple: false,
        description: 'Fixed boolean value stored on the node itself.',
      },
    ],
    [
      {
        key: 'boolean',
        label: 'Boolean',
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
        label: 'Boolean',
        data_type: 'select',
        options: ['true', 'false'],
      },
    ],
    '#ef9a9a',
  );

  insertIfMissing(
    'Random Prompt From Group',
    'Pick one prompt entry from a stored prompt group and expose it as reusable workflow text.',
    'prompt',
    [
      {
        key: 'group_name',
        label: 'Group Name',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: 'Exact prompt group name to sample from when group_id is not provided.',
      },
      {
        key: 'group_id',
        label: 'Group ID',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        description: 'Prompt group id. If set, this wins over group_name.',
      },
      {
        key: 'type',
        label: 'Collection Type',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        default_value: 'positive',
        description: 'positive, negative, or auto',
      },
      {
        key: 'seed',
        label: 'Seed',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        description: 'Optional deterministic selector seed.',
      },
    ],
    [
      {
        key: 'prompt',
        label: 'Prompt',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'text',
        label: 'Text',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'entry_json',
        label: 'Entry JSON',
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
        label: 'Group Name',
        data_type: 'text',
        placeholder: '예: Character Pose / Costume / Auto Tags',
      },
      {
        key: 'group_id',
        label: 'Group ID',
        data_type: 'number',
      },
      {
        key: 'type',
        label: 'Collection Type',
        data_type: 'select',
        default_value: 'positive',
        options: ['positive', 'negative', 'auto'],
      },
      {
        key: 'seed',
        label: 'Seed',
        data_type: 'number',
      },
    ],
    '#26a69a',
  );

  insertIfMissing(
    'Find Similar Images',
    'Search the active library for visually similar images based on one input image.',
    'image',
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: 'Input image used as the similarity search target.',
      },
      {
        key: 'limit',
        label: 'Limit',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 12,
        description: 'Maximum number of similar images to return.',
      },
      {
        key: 'threshold',
        label: 'Threshold',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 15,
        description: 'Maximum perceptual hash distance allowed for matches.',
      },
      {
        key: 'include_prompt',
        label: 'Include Prompt',
        direction: 'input',
        data_type: 'boolean',
        required: false,
        multiple: false,
        default_value: true,
        description: 'Include prompt metadata in each returned match record.',
      },
    ],
    [
      {
        key: 'matches',
        label: 'Matches',
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
        label: 'Limit',
        data_type: 'number',
        default_value: 12,
      },
      {
        key: 'threshold',
        label: 'Threshold',
        data_type: 'number',
        default_value: 15,
      },
      {
        key: 'include_prompt',
        label: 'Include Prompt',
        data_type: 'checkbox',
        default_value: true,
      },
    ],
    '#42a5f5',
  );

  insertIfMissing(
    'Load Prompt From Reference',
    'Resolve one image reference into reusable prompt text and metadata.',
    'prompt',
    [
      {
        key: 'reference',
        label: 'Reference',
        direction: 'input',
        data_type: 'json',
        required: false,
        multiple: false,
        description: 'Structured reference JSON, such as the output of Find Similar Images.',
      },
      {
        key: 'composite_hash',
        label: 'Composite Hash',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: 'Direct image composite hash. If set, this wins over reference JSON.',
      },
      {
        key: 'index',
        label: 'Index',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 0,
        description: 'Which item to read when the reference contains an items array.',
      },
    ],
    [
      {
        key: 'prompt',
        label: 'Prompt',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'text',
        label: 'Text',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'metadata',
        label: 'Metadata',
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
        label: 'Composite Hash',
        data_type: 'text',
      },
      {
        key: 'index',
        label: 'Index',
        data_type: 'number',
        default_value: 0,
      },
    ],
    '#66bb6a',
  );

  insertIfMissing(
    'Load Image From Reference',
    'Resolve one image reference into an actual graph image artifact.',
    'image',
    [
      {
        key: 'reference',
        label: 'Reference',
        direction: 'input',
        data_type: 'json',
        required: false,
        multiple: false,
        description: 'Structured reference JSON, such as the output of Find Similar Images.',
      },
      {
        key: 'composite_hash',
        label: 'Composite Hash',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: 'Direct image composite hash. If set, this wins over reference JSON.',
      },
      {
        key: 'index',
        label: 'Index',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 0,
        description: 'Which item to read when the reference contains an items array.',
      },
    ],
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'output',
        data_type: 'image',
        required: true,
        multiple: false,
      },
      {
        key: 'image_ref',
        label: 'Image Reference',
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
        label: 'Composite Hash',
        data_type: 'text',
      },
      {
        key: 'index',
        label: 'Index',
        data_type: 'number',
        default_value: 0,
      },
    ],
    '#29b6f6',
  );

  insertIfMissing(
    'Random Image From Library',
    'Pick one random image from the active library and expose it as a reusable graph image.',
    'image',
    [],
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'output',
        data_type: 'image',
        required: true,
        multiple: false,
      },
      {
        key: 'image_ref',
        label: 'Image Reference',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
      {
        key: 'metadata',
        label: 'Metadata',
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

  insertIfMissing(
    'Extract Tags From Image',
    'Run the configured image tagger on one image input and expose prompt-friendly tags.',
    'analysis',
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: 'Input image used for tag extraction.',
      },
    ],
    [
      {
        key: 'tags_text',
        label: 'Tags Text',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'tags_prompt',
        label: 'Tags Prompt',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'tags_json',
        label: 'Tags JSON',
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

  insertIfMissing(
    'Final Result',
    'Declare one upstream artifact as an explicit workflow final result without duplicating stored payloads.',
    'output',
    [
      {
        key: 'value',
        label: 'Value',
        direction: 'input',
        data_type: 'any',
        required: true,
        multiple: false,
        description: 'Any upstream artifact that should be recorded as one final workflow result.',
      },
    ],
    [],
    { operation_key: 'system.final_result' },
    [],
    '#ffa726',
  );

  insertIfMissing(
    'Extract Artist From Image',
    'Run the configured Kaloscope artist tagger on one image input and expose artist/style hints.',
    'analysis',
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: 'Input image used for artist/style extraction.',
      },
    ],
    [
      {
        key: 'artist_text',
        label: 'Artist Text',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'artist_prompt',
        label: 'Artist Prompt',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'artist_json',
        label: 'Artist JSON',
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
