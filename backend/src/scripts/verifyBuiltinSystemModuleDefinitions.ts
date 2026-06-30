import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { seedBuiltinSystemModuleDefinitions, type UpsertBuiltinSystemModule } from '../database/userSettingsBuiltinModuleDefinitions'
import { getSupportedSystemOperationKeys } from '../services/graph-workflow-executor/execute-system'
import type { ModulePortDataType, ModulePortDirection } from '../types/moduleGraph'

type BuiltinSystemModuleDefinition = {
  name: string
  description: string
  category: string
  exposedInputs: unknown
  outputPorts: unknown
  internalFixedValues: { operation_key: string } & Record<string, unknown>
  uiSchema: unknown
  color: string
  legacyNames: string[]
}

type PortLike = {
  key?: unknown
  label?: unknown
  direction?: unknown
  data_type?: unknown
  required?: unknown
  multiple?: unknown
}

type UiFieldLike = {
  key?: unknown
  label?: unknown
  data_type?: unknown
  options?: unknown
}

const VALID_PORT_DIRECTIONS = new Set<ModulePortDirection>(['input', 'output'])
const VALID_PORT_DATA_TYPES = new Set<ModulePortDataType>(['image', 'mask', 'prompt', 'text', 'number', 'boolean', 'json', 'any'])
const VALID_UI_DATA_TYPES = new Set([...VALID_PORT_DATA_TYPES, 'select'])
const SOURCE_ROOT = resolve(__dirname, '..')

function source(relativePath: string) {
  return readFileSync(join(SOURCE_ROOT, relativePath), 'utf8')
}

function collectBuiltinSystemModules() {
  const definitions: BuiltinSystemModuleDefinition[] = []

  const collectDefinition: UpsertBuiltinSystemModule = (
    name,
    description,
    category,
    exposedInputs,
    outputPorts,
    internalFixedValues,
    uiSchema,
    color,
    legacyNames = [],
  ) => {
    definitions.push({
      name,
      description,
      category,
      exposedInputs,
      outputPorts,
      internalFixedValues,
      uiSchema,
      color,
      legacyNames,
    })
  }

  seedBuiltinSystemModuleDefinitions(collectDefinition)
  return definitions
}

function describeModule(definition: BuiltinSystemModuleDefinition) {
  return `${definition.name} (${definition.internalFixedValues.operation_key || 'missing operation_key'})`
}

function isJsonSerializable(value: unknown) {
  try {
    JSON.stringify(value)
    return true
  } catch {
    return false
  }
}

function assertTextField(failures: string[], moduleLabel: string, fieldName: string, value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push(`${moduleLabel}: ${fieldName} must be a non-empty string`)
  }
}

function validatePorts(params: {
  failures: string[]
  moduleLabel: string
  ports: unknown
  fieldName: string
  expectedDirection: ModulePortDirection
}) {
  const { failures, moduleLabel, ports, fieldName, expectedDirection } = params

  if (!Array.isArray(ports)) {
    failures.push(`${moduleLabel}: ${fieldName} must be an array`)
    return new Set<string>()
  }

  const keys = new Set<string>()
  for (const [index, port] of ports.entries()) {
    const portLabel = `${moduleLabel}: ${fieldName}[${index}]`
    const typedPort = port as PortLike

    assertTextField(failures, portLabel, 'key', typedPort.key)
    assertTextField(failures, portLabel, 'label', typedPort.label)

    if (!VALID_PORT_DIRECTIONS.has(typedPort.direction as ModulePortDirection)) {
      failures.push(`${portLabel}: direction must be input or output`)
    } else if (typedPort.direction !== expectedDirection) {
      failures.push(`${portLabel}: direction must be ${expectedDirection}`)
    }

    if (!VALID_PORT_DATA_TYPES.has(typedPort.data_type as ModulePortDataType)) {
      failures.push(`${portLabel}: data_type is not supported`)
    }

    if (typedPort.required !== undefined && typeof typedPort.required !== 'boolean') {
      failures.push(`${portLabel}: required must be boolean when provided`)
    }

    if (typedPort.multiple !== undefined && typeof typedPort.multiple !== 'boolean') {
      failures.push(`${portLabel}: multiple must be boolean when provided`)
    }

    if (typeof typedPort.key === 'string') {
      if (keys.has(typedPort.key)) {
        failures.push(`${moduleLabel}: duplicate ${fieldName} key ${typedPort.key}`)
      }
      keys.add(typedPort.key)
    }
  }

  return keys
}

function validateUiSchema(params: {
  failures: string[]
  moduleLabel: string
  uiSchema: unknown
}) {
  const { failures, moduleLabel, uiSchema } = params

  if (!Array.isArray(uiSchema)) {
    failures.push(`${moduleLabel}: uiSchema must be an array`)
    return
  }

  const keys = new Set<string>()
  for (const [index, field] of uiSchema.entries()) {
    const fieldLabel = `${moduleLabel}: uiSchema[${index}]`
    const typedField = field as UiFieldLike

    assertTextField(failures, fieldLabel, 'key', typedField.key)
    assertTextField(failures, fieldLabel, 'label', typedField.label)

    if (!VALID_UI_DATA_TYPES.has(typedField.data_type as ModulePortDataType | 'select')) {
      failures.push(`${fieldLabel}: data_type is not supported`)
    }

    if (typeof typedField.key === 'string') {
      if (keys.has(typedField.key)) {
        failures.push(`${moduleLabel}: duplicate uiSchema key ${typedField.key}`)
      }
      keys.add(typedField.key)
    }
  }
}

function validateBuiltinSystemModules() {
  const definitions = collectBuiltinSystemModules()
  const supportedOperationKeys = new Set(getSupportedSystemOperationKeys())
  const failures: string[] = []
  const names = new Set<string>()
  const operationKeys = new Set<string>()

  for (const definition of definitions) {
    const moduleLabel = describeModule(definition)
    assertTextField(failures, moduleLabel, 'name', definition.name)
    assertTextField(failures, moduleLabel, 'description', definition.description)
    assertTextField(failures, moduleLabel, 'category', definition.category)
    assertTextField(failures, moduleLabel, 'color', definition.color)

    if (names.has(definition.name)) {
      failures.push(`${moduleLabel}: duplicate module name`)
    }
    names.add(definition.name)

    const operationKey = definition.internalFixedValues.operation_key
    assertTextField(failures, moduleLabel, 'operation_key', operationKey)
    if (operationKeys.has(operationKey)) {
      failures.push(`${moduleLabel}: duplicate operation_key`)
    }
    operationKeys.add(operationKey)

    if (!supportedOperationKeys.has(operationKey)) {
      failures.push(`${moduleLabel}: operation_key has no executor handler`)
    }

    if (!isJsonSerializable(definition.exposedInputs)) {
      failures.push(`${moduleLabel}: exposedInputs must be JSON serializable`)
    }
    if (!isJsonSerializable(definition.outputPorts)) {
      failures.push(`${moduleLabel}: outputPorts must be JSON serializable`)
    }
    if (!isJsonSerializable(definition.internalFixedValues)) {
      failures.push(`${moduleLabel}: internalFixedValues must be JSON serializable`)
    }
    if (!isJsonSerializable(definition.uiSchema)) {
      failures.push(`${moduleLabel}: uiSchema must be JSON serializable`)
    }

    validatePorts({
      failures,
      moduleLabel,
      ports: definition.exposedInputs,
      fieldName: 'exposedInputs',
      expectedDirection: 'input',
    })
    validatePorts({
      failures,
      moduleLabel,
      ports: definition.outputPorts,
      fieldName: 'outputPorts',
      expectedDirection: 'output',
    })
    validateUiSchema({ failures, moduleLabel, uiSchema: definition.uiSchema })
  }

  if (failures.length > 0) {
    throw new Error(`Built-in system module verification failed\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  }

  const seedSource = source('database/userSettingsBuiltinModuleDefinitions.ts')
  const dataSource = source('database/userSettingsBuiltinModuleDefinitionData.ts')
  if (!seedSource.includes('for (const definition of BUILTIN_SYSTEM_MODULE_DEFINITIONS)')) {
    throw new Error('Built-in system module seed should iterate over the data definition table')
  }
  if ((seedSource.match(/upsertBuiltinModule\(/g) ?? []).length !== 1) {
    throw new Error('Built-in system module seed should keep only one upsert call in the loop')
  }
  if (!dataSource.includes('export const BUILTIN_SYSTEM_MODULE_DEFINITIONS')) {
    throw new Error('Built-in system module definitions should live in the dedicated data file')
  }

  console.log(
    `✅ Built-in system module definitions verified (${definitions.length} modules, ${operationKeys.size} operation handlers matched)`,
  )
}

validateBuiltinSystemModules()
