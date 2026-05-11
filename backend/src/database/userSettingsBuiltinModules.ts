import Database from 'better-sqlite3';
import { seedBuiltinSystemModuleDefinitions } from './userSettingsBuiltinModuleDefinitions';

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

  seedBuiltinSystemModuleDefinitions(upsertBuiltinModule);
}
