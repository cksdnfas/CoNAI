import { GraphExecutionFinalResultModel } from '../../models/GraphExecutionFinalResult'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { replacePromotedFinalResultSourceWithCanonicalMedia, tryPromoteFinalResultArtifactToGenerationHistory } from './final-result-promotion'
import {
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

/** Register one upstream artifact as an explicit workflow final result. */
export async function executeFinalResultNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  _resolvedInputs: Record<string, any>,
) {
  const incomingEdges = context.workflow.graph.edges.filter((edge) => edge.target_node_id === node.id && edge.target_port_key === 'value')

  if (incomingEdges.length === 0) {
    throw new Error('최종 결과 노드는 값 포트에 연결된 업스트림 결과물 1개가 필요해')
  }

  if (incomingEdges.length > 1) {
    throw new Error('최종 결과 노드는 값 포트에 업스트림 결과물 1개만 연결할 수 있어')
  }

  const sourceEdge = incomingEdges[0]
  const sourceArtifact = context.artifactsByNode.get(sourceEdge.source_node_id)?.[sourceEdge.source_port_key]
  if (!sourceArtifact?.artifactRecordId) {
    const warningDetails = {
      engine: 'system',
      operationKey: 'system.final_result',
      sourceNodeId: sourceEdge.source_node_id,
      sourcePortKey: sourceEdge.source_port_key,
      skippedReason: 'source_artifact_not_persisted',
    }

    context.artifactsByNode.set(node.id, {})
    writeExecutionLog({
      executionId: context.executionId,
      nodeId: node.id,
      level: 'warn',
      eventType: 'final_result_source_artifact_missing',
      message: 'Final result node ran, but the source output was not persisted',
      details: warningDetails,
      always: true,
    })
    writeExecutionLog({
      executionId: context.executionId,
      nodeId: node.id,
      eventType: 'node_engine_complete',
      message: `System module completed without persisted final result: ${moduleDefinition.name}`,
      details: warningDetails,
    })
    return
  }

  const finalResultId = GraphExecutionFinalResultModel.create({
    execution_id: context.executionId,
    final_node_id: node.id,
    source_artifact_id: sourceArtifact.artifactRecordId,
    source_node_id: sourceEdge.source_node_id,
    source_port_key: sourceEdge.source_port_key,
    artifact_type: sourceArtifact.type,
  })

  const promotionResult = await tryPromoteFinalResultArtifactToGenerationHistory({
    executionId: context.executionId,
    workflowId: context.workflow.id,
    workflowName: context.workflow.name,
    finalNodeId: node.id,
    sourceNodeId: sourceEdge.source_node_id,
    sourcePortKey: sourceEdge.source_port_key,
    sourceArtifact,
  })
  const canonicalReplacementResult = await replacePromotedFinalResultSourceWithCanonicalMedia(sourceArtifact, promotionResult)

  context.artifactsByNode.set(node.id, {})

  if (promotionResult.reason === 'promotion_failed') {
    writeExecutionLog({
      executionId: context.executionId,
      nodeId: node.id,
      level: 'warn',
      eventType: 'final_result_promotion_failed',
      message: 'Final result was saved, but generation history promotion failed',
      details: {
        engine: 'system',
        operationKey: 'system.final_result',
        sourceNodeId: sourceEdge.source_node_id,
        sourcePortKey: sourceEdge.source_port_key,
        sourceArtifactId: sourceArtifact.artifactRecordId,
        errorMessage: 'errorMessage' in promotionResult ? promotionResult.errorMessage : null,
      },
      always: true,
    })
  }

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: 'system.final_result',
      sourceNodeId: sourceEdge.source_node_id,
      sourcePortKey: sourceEdge.source_port_key,
      sourceArtifactId: sourceArtifact.artifactRecordId,
      finalResultId,
      artifactType: sourceArtifact.type,
      promotion: promotionResult,
      canonicalReplacement: canonicalReplacementResult,
    },
  })
}
