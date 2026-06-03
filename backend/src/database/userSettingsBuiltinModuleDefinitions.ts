import { BUILTIN_SYSTEM_MODULE_DEFINITIONS } from './userSettingsBuiltinModuleDefinitionData';

export type UpsertBuiltinSystemModule = (
  name: string,
  description: string,
  category: string,
  exposedInputs: unknown,
  outputPorts: unknown,
  internalFixedValues: { operation_key: string } & Record<string, unknown>,
  uiSchema: unknown,
  color: string,
  legacyNames?: string[],
) => void;

export type BuiltinSystemModuleDefinition = {
  name: string;
  description: string;
  category: string;
  exposedInputs: unknown;
  outputPorts: unknown;
  internalFixedValues: { operation_key: string } & Record<string, unknown>;
  uiSchema: unknown;
  color: string;
  legacyNames?: string[];
};

export function seedBuiltinSystemModuleDefinitions(upsertBuiltinModule: UpsertBuiltinSystemModule): void {
  for (const definition of BUILTIN_SYSTEM_MODULE_DEFINITIONS) {
    upsertBuiltinModule(
      definition.name,
      definition.description,
      definition.category,
      definition.exposedInputs,
      definition.outputPorts,
      definition.internalFixedValues,
      definition.uiSchema,
      definition.color,
      definition.legacyNames,
    );
  }
}
