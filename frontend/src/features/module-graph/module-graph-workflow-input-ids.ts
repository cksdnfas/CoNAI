/** Build one canonical workflow-exposed-input id from node and port keys. */
export function buildWorkflowExposedInputId(nodeId: string, portKey: string) {
  return `${nodeId}:${portKey}`
}
