import { ModuleDefinitionModel } from '../../models/ModuleDefinition';
import type {
  ModuleAuthoringSource,
  ModuleDefinitionCreateData,
  ModuleDefinitionRecord,
  ModuleEngineType,
  ModuleGraphResponse,
} from '../../types/moduleGraph';

type TargetModuleValidation = {
  engineType: ModuleEngineType;
  authoringSource: ModuleAuthoringSource;
  invalidTypeError: string;
  sourceWorkflowId?: number;
};

type TargetModuleResolution =
  | { targetModule: ModuleDefinitionRecord | null }
  | { status: number; error: string };

export function parseOptionalTargetModuleId(value: unknown): number | null {
  return value !== undefined && value !== null ? Number(value) : null;
}

export function resolveTargetModule(
  targetModuleId: number | null,
  validation: TargetModuleValidation,
): TargetModuleResolution {
  const targetModule = targetModuleId ? ModuleDefinitionModel.findById(targetModuleId) : null;
  if (targetModuleId && !targetModule) {
    return { status: 404, error: 'Target module definition not found' };
  }

  if (targetModule && (
    targetModule.engine_type !== validation.engineType
    || targetModule.authoring_source !== validation.authoringSource
  )) {
    return { status: 400, error: validation.invalidTypeError };
  }

  if (
    targetModule
    && validation.sourceWorkflowId !== undefined
    && targetModule.source_workflow_id !== validation.sourceWorkflowId
  ) {
    return { status: 400, error: 'Target module belongs to a different ComfyUI workflow' };
  }

  return { targetModule };
}

export function persistModuleDefinitionUpsert(
  targetModule: ModuleDefinitionRecord | null,
  createData: ModuleDefinitionCreateData,
  messages: { created: string; updated: string; noChanges: string },
) {
  if (targetModule) {
    const updated = ModuleDefinitionModel.update(targetModule.id, {
      ...createData,
      version: (targetModule.version ?? 1) + 1,
    });

    return {
      status: 200,
      body: {
        success: updated,
        data: {
          id: targetModule.id,
          message: updated ? messages.updated : messages.noChanges,
        },
      } as ModuleGraphResponse,
    };
  }

  const id = ModuleDefinitionModel.create(createData);
  return {
    status: 201,
    body: {
      success: true,
      data: {
        id,
        message: messages.created,
      },
    } as ModuleGraphResponse,
  };
}
