import type { MarkedField } from '../../types/workflow';

function setValueByPath(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

export function substituteComfyPromptData(
  workflowJson: string,
  markedFields: MarkedField[],
  promptData: Record<string, any>
): any {
  const workflow = JSON.parse(workflowJson);

  for (const field of markedFields) {
    const value = promptData[field.id];
    if (value !== undefined && value !== null) {
      setValueByPath(workflow, field.jsonPath, value);
    } else if (field.default_value !== undefined) {
      setValueByPath(workflow, field.jsonPath, field.default_value);
    }
  }

  return workflow;
}
