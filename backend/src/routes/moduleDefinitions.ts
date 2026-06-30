import { Router, Request, Response } from 'express'
import { routeParam } from './routeParam'
import { ModuleDefinitionModel } from '../models/ModuleDefinition'
import { WorkflowModel } from '../models/Workflow'
import { CustomDropdownListModel } from '../models/CustomDropdownList'
import {
  ModuleGraphResponse,
  ModuleDefinitionCreateData,
  ModuleDefinitionUpdateData,
  ModuleDefinitionRecord,
} from '../types/moduleGraph'
import { asyncHandler } from '../middleware/errorHandler'
import { localizeDisplayLabel, localizeModuleName } from '../services/moduleDefinitions/labels'
import {
  buildUiSchemaFromMarkedFields,
  buildUiSchemaFromPorts,
  convertMarkedFieldsToPorts,
  createDefaultOutputPorts,
  getConfigOnlyFieldKeys,
  normalizeNaiExposedFields,
  splitFixedValues,
} from '../services/moduleDefinitions/schemaBuilder'
import { parseOptionalTargetModuleId, persistModuleDefinitionUpsert, resolveTargetModule } from '../services/moduleDefinitions/upsert'

const router = Router()

const DROPDOWN_RANDOM_OPTION = { value: '__random__', label: '랜덤 선택' } as const

function buildCustomDropdownListMap() {
  return new Map(CustomDropdownListModel.findAll().map((list) => [list.name, list.items]))
}

function getCustomDropdownListName(field: any) {
  const directName = typeof field?.dropdown_list_name === 'string' ? field.dropdown_list_name.trim() : ''
  if (directName.length > 0) {
    return directName
  }

  const legacyHintName = typeof field?.ui_hint === 'string' ? field.ui_hint.trim() : ''
  return legacyHintName.length > 0 ? legacyHintName : null
}

function buildDropdownSelectOptions(items: string[]) {
  return [
    DROPDOWN_RANDOM_OPTION,
    ...items.filter((item) => item.trim().length > 0 && item !== DROPDOWN_RANDOM_OPTION.value),
  ]
}

function hydrateDynamicSelectOptions(uiSchema: any[], dropdownListMap: Map<string, string[]>) {
  return uiSchema.map((field: any) => {
    if (field?.data_type !== 'select') {
      return field
    }

    const dropdownListName = getCustomDropdownListName(field)
    if (!dropdownListName) {
      return field
    }

    const dropdownItems = dropdownListMap.get(dropdownListName)
    if (!dropdownItems) {
      return {
        ...field,
        dropdown_list_name: dropdownListName,
        options: [],
      }
    }

    return {
      ...field,
      dropdown_list_name: dropdownListName,
      options: buildDropdownSelectOptions(dropdownItems),
    }
  })
}

function parseModuleRecord(record: any, dropdownListMap = buildCustomDropdownListMap()) {
  const parsed = {
    ...record,
    template_defaults: record.template_defaults ? JSON.parse(record.template_defaults) : {},
    exposed_inputs: record.exposed_inputs ? JSON.parse(record.exposed_inputs) : [],
    output_ports: record.output_ports ? JSON.parse(record.output_ports) : [],
    internal_fixed_values: record.internal_fixed_values ? JSON.parse(record.internal_fixed_values) : {},
    ui_schema: record.ui_schema ? JSON.parse(record.ui_schema) : [],
  }
  const hydratedUiSchema = hydrateDynamicSelectOptions(parsed.ui_schema, dropdownListMap)
  const configOnlyFieldKeys = getConfigOnlyFieldKeys(parsed.ui_schema, parsed.exposed_inputs)

  return {
    ...parsed,
    name: localizeModuleName(parsed.name, parsed.authoring_source),
    exposed_inputs: parsed.exposed_inputs
      .filter((port: any) => !configOnlyFieldKeys.has(port.key))
      .map((port: any) => ({
        ...port,
        label: localizeDisplayLabel(port.key, port.label),
      })),
    output_ports: parsed.output_ports.map((port: any) => ({
      ...port,
      label: localizeDisplayLabel(port.key, port.label),
    })),
    ui_schema: hydratedUiSchema.map((field: any) => ({
      ...field,
      label: localizeDisplayLabel(field.key, field.label),
    })),
  }
}

function sendModuleGraphError(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error } as ModuleGraphResponse)
}

function sendModuleDefinitionUpsert(
  res: Response,
  targetModule: ModuleDefinitionRecord | null,
  createData: ModuleDefinitionCreateData,
  messages: { created: string; updated: string; noChanges?: string },
) {
  const result = persistModuleDefinitionUpsert(targetModule, createData, {
    ...messages,
    noChanges: messages.noChanges ?? 'No changes applied',
  })

  return res.status(result.status).json(result.body)
}

router.post('/from-nai-snapshot', asyncHandler(async (req: Request, res: Response) => {
  const {
    name,
    description,
    category,
    color,
    snapshot,
    exposed_fields,
    output_ports,
    ui_schema,
    is_active,
    target_module_id,
  } = req.body

  if (!name || !snapshot || typeof snapshot !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'name and snapshot are required',
    } as ModuleGraphResponse)
  }

  try {
    const targetModuleId = parseOptionalTargetModuleId(target_module_id)
    const targetResult = resolveTargetModule(targetModuleId, {
      engineType: 'nai',
      authoringSource: 'nai_form_snapshot',
      invalidTypeError: 'Target module is not a NAI snapshot module',
    })
    if ('error' in targetResult) {
      return sendModuleGraphError(res, targetResult.status, targetResult.error)
    }
    const { targetModule } = targetResult

    const exists = ModuleDefinitionModel.existsByName(name, targetModuleId ?? undefined)
    if (exists) {
      return res.status(409).json({ success: false, error: 'Module definition name already exists' } as ModuleGraphResponse)
    }

    const snapshotRecord = snapshot as Record<string, unknown>
    const exposedInputs = normalizeNaiExposedFields(exposed_fields, snapshotRecord)
    const createData: ModuleDefinitionCreateData = {
      name,
      description,
      engine_type: 'nai',
      authoring_source: 'nai_form_snapshot',
      category: category || 'generation',
      template_defaults: snapshotRecord,
      exposed_inputs: exposedInputs,
      output_ports: Array.isArray(output_ports) && output_ports.length > 0 ? output_ports : createDefaultOutputPorts('nai'),
      internal_fixed_values: splitFixedValues(snapshotRecord, exposedInputs),
      ui_schema: Array.isArray(ui_schema) && ui_schema.length > 0 ? ui_schema : buildUiSchemaFromPorts(exposedInputs),
      is_active,
      color,
    }

    return sendModuleDefinitionUpsert(res, targetModule, createData, {
      created: 'NAI snapshot module created successfully',
      updated: 'NAI snapshot module updated successfully',
    })
  } catch (error) {
    console.error('Error creating NAI snapshot module:', error)
    return res.status(500).json({ success: false, error: 'Failed to create NAI snapshot module' } as ModuleGraphResponse)
  }
}))

router.post('/from-codex-snapshot', asyncHandler(async (req: Request, res: Response) => {
  const {
    name,
    description,
    category,
    color,
    snapshot,
    exposed_fields,
    output_ports,
    ui_schema,
    is_active,
    target_module_id,
  } = req.body

  if (!name || !snapshot || typeof snapshot !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'name and snapshot are required',
    } as ModuleGraphResponse)
  }

  try {
    const targetModuleId = parseOptionalTargetModuleId(target_module_id)
    const targetResult = resolveTargetModule(targetModuleId, {
      engineType: 'codex',
      authoringSource: 'codex_form_snapshot',
      invalidTypeError: 'Target module is not a Codex snapshot module',
    })
    if ('error' in targetResult) {
      return sendModuleGraphError(res, targetResult.status, targetResult.error)
    }
    const { targetModule } = targetResult

    const exists = ModuleDefinitionModel.existsByName(name, targetModuleId ?? undefined)
    if (exists) {
      return res.status(409).json({ success: false, error: 'Module definition name already exists' } as ModuleGraphResponse)
    }

    const snapshotRecord = snapshot as Record<string, unknown>
    const exposedInputs = normalizeNaiExposedFields(exposed_fields, snapshotRecord)
    const createData: ModuleDefinitionCreateData = {
      name,
      description,
      engine_type: 'codex',
      authoring_source: 'codex_form_snapshot',
      category: category || 'generation',
      template_defaults: snapshotRecord,
      exposed_inputs: exposedInputs,
      output_ports: Array.isArray(output_ports) && output_ports.length > 0 ? output_ports : createDefaultOutputPorts('codex'),
      internal_fixed_values: splitFixedValues(snapshotRecord, exposedInputs),
      ui_schema: Array.isArray(ui_schema) && ui_schema.length > 0 ? ui_schema : buildUiSchemaFromPorts(exposedInputs),
      is_active,
      color,
    }

    return sendModuleDefinitionUpsert(res, targetModule, createData, {
      created: 'Codex snapshot module created successfully',
      updated: 'Codex snapshot module updated successfully',
    })
  } catch (error) {
    console.error('Error creating Codex snapshot module:', error)
    return res.status(500).json({ success: false, error: 'Failed to create Codex snapshot module' } as ModuleGraphResponse)
  }
}))

router.post('/from-comfy-workflow/:workflowId', asyncHandler(async (req: Request, res: Response) => {
  const workflowId = parseInt(routeParam(routeParam(req.params.workflowId)))
  if (isNaN(workflowId)) {
    return res.status(400).json({ success: false, error: 'Invalid workflow ID' } as ModuleGraphResponse)
  }

  const {
    name,
    description,
    category,
    color,
    exposed_field_ids,
    output_ports,
    ui_schema,
    is_active,
    target_module_id,
  } = req.body

  try {
    const workflow = WorkflowModel.findById(workflowId)
    if (!workflow) {
      return res.status(404).json({ success: false, error: 'Workflow not found' } as ModuleGraphResponse)
    }

    const targetModuleId = parseOptionalTargetModuleId(target_module_id)
    const targetResult = resolveTargetModule(targetModuleId, {
      engineType: 'comfyui',
      authoringSource: 'comfyui_workflow_wrap',
      invalidTypeError: 'Target module is not a ComfyUI workflow module',
      sourceWorkflowId: workflow.id,
    })
    if ('error' in targetResult) {
      return sendModuleGraphError(res, targetResult.status, targetResult.error)
    }
    const { targetModule } = targetResult

    const moduleName = name || `${workflow.name} 모듈`
    if (ModuleDefinitionModel.existsByName(moduleName, targetModuleId ?? undefined)) {
      return res.status(409).json({ success: false, error: 'Module definition name already exists' } as ModuleGraphResponse)
    }

    const markedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : []
    const exposedInputs = convertMarkedFieldsToPorts(markedFields, exposed_field_ids)
    const templateDefaults = {
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      workflow_json: JSON.parse(workflow.workflow_json),
      api_endpoint: workflow.api_endpoint,
      marked_fields: markedFields,
    }

    const defaultInputValues = Object.fromEntries(markedFields.map((field: any) => [field.id, field.default_value ?? null]))
    const createData: ModuleDefinitionCreateData = {
      name: moduleName,
      description: description || workflow.description || undefined,
      engine_type: 'comfyui',
      authoring_source: 'comfyui_workflow_wrap',
      category: category || 'generation',
      source_workflow_id: workflow.id,
      template_defaults: templateDefaults,
      exposed_inputs: exposedInputs,
      output_ports: Array.isArray(output_ports) && output_ports.length > 0 ? output_ports : createDefaultOutputPorts('comfyui'),
      internal_fixed_values: splitFixedValues(defaultInputValues, exposedInputs),
      ui_schema: Array.isArray(ui_schema) && ui_schema.length > 0 ? ui_schema : buildUiSchemaFromMarkedFields(markedFields, exposed_field_ids),
      is_active,
      color: color || workflow.color,
    }

    return sendModuleDefinitionUpsert(res, targetModule, createData, {
      created: 'ComfyUI workflow module created successfully',
      updated: 'ComfyUI workflow module updated successfully',
    })
  } catch (error) {
    console.error('Error creating ComfyUI workflow module:', error)
    return res.status(500).json({ success: false, error: 'Failed to create ComfyUI workflow module' } as ModuleGraphResponse)
  }
}))

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.active === 'true'
    const dropdownListMap = buildCustomDropdownListMap()
    const modules = ModuleDefinitionModel.findAll(activeOnly).map((record) => parseModuleRecord(record, dropdownListMap))

    const response: ModuleGraphResponse = {
      success: true,
      data: modules,
    }

    return res.json(response)
  } catch (error) {
    console.error('Error getting module definitions:', error)
    return res.status(500).json({ success: false, error: 'Failed to get module definitions' } as ModuleGraphResponse)
  }
}))

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)))
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid module definition ID' } as ModuleGraphResponse)
  }

  try {
    const moduleDefinition = ModuleDefinitionModel.findById(id)
    if (!moduleDefinition) {
      return res.status(404).json({ success: false, error: 'Module definition not found' } as ModuleGraphResponse)
    }

    return res.json({ success: true, data: parseModuleRecord(moduleDefinition) } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting module definition:', error)
    return res.status(500).json({ success: false, error: 'Failed to get module definition' } as ModuleGraphResponse)
  }
}))

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const {
    name,
    description,
    engine_type,
    authoring_source,
    category,
    source_workflow_id,
    template_defaults,
    exposed_inputs,
    output_ports,
    internal_fixed_values,
    ui_schema,
    version,
    is_active,
    color,
  } = req.body

  if (!name || !engine_type || !authoring_source || !template_defaults || !exposed_inputs || !output_ports) {
    return res.status(400).json({
      success: false,
      error: 'name, engine_type, authoring_source, template_defaults, exposed_inputs, and output_ports are required',
    } as ModuleGraphResponse)
  }

  try {
    const exists = ModuleDefinitionModel.existsByName(name)
    if (exists) {
      return res.status(409).json({ success: false, error: 'Module definition name already exists' } as ModuleGraphResponse)
    }

    const createData: ModuleDefinitionCreateData = {
      name,
      description,
      engine_type,
      authoring_source,
      category,
      source_workflow_id,
      template_defaults,
      exposed_inputs,
      output_ports,
      internal_fixed_values,
      ui_schema,
      version,
      is_active,
      color,
    }

    const id = ModuleDefinitionModel.create(createData)
    return res.status(201).json({ success: true, data: { id, message: 'Module definition created successfully' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error creating module definition:', error)
    return res.status(500).json({ success: false, error: 'Failed to create module definition' } as ModuleGraphResponse)
  }
}))

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)))
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid module definition ID' } as ModuleGraphResponse)
  }

  try {
    const existing = ModuleDefinitionModel.findById(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Module definition not found' } as ModuleGraphResponse)
    }

    if (req.body.name && ModuleDefinitionModel.existsByName(req.body.name, id)) {
      return res.status(409).json({ success: false, error: 'Module definition name already exists' } as ModuleGraphResponse)
    }

    const updateData: ModuleDefinitionUpdateData = {
      name: req.body.name,
      description: req.body.description,
      category: req.body.category,
      template_defaults: req.body.template_defaults,
      exposed_inputs: req.body.exposed_inputs,
      output_ports: req.body.output_ports,
      internal_fixed_values: req.body.internal_fixed_values,
      ui_schema: req.body.ui_schema,
      version: req.body.version,
      is_active: req.body.is_active,
      color: req.body.color,
    }

    const updated = ModuleDefinitionModel.update(id, updateData)
    return res.json({ success: updated, data: { id, message: updated ? 'Module definition updated successfully' : 'No changes applied' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error updating module definition:', error)
    return res.status(500).json({ success: false, error: 'Failed to update module definition' } as ModuleGraphResponse)
  }
}))

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)))
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid module definition ID' } as ModuleGraphResponse)
  }

  try {
    const deleted = ModuleDefinitionModel.delete(id)
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Module definition not found' } as ModuleGraphResponse)
    }

    return res.json({ success: true, data: { message: 'Module definition deleted successfully' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error deleting module definition:', error)
    return res.status(500).json({ success: false, error: 'Failed to delete module definition' } as ModuleGraphResponse)
  }
}))

export const moduleDefinitionRoutes = router
export default router
