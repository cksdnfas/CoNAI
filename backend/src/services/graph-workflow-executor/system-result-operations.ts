import { GraphExecutionFinalResultModel } from '../../models/GraphExecutionFinalResult'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { assignGeneratedMediaToGroup } from '../generationTargetGroupService'
import { GroupPathService } from '../groupPathService'
import { replacePromotedFinalResultSourceWithCanonicalMedia, tryPromoteFinalResultArtifactToGenerationHistory } from './final-result-promotion'
import {
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

/**
 * 최종 결과를 넣을 이미지 그룹을 정한다. 노드의 그룹 경로가 실행 기본 그룹보다 우선한다.
 * 경로는 없는 그룹을 만들어 가며 해석하고, 잘못된 경로는 노드 실패로 드러낸다.
 */
function resolveFinalResultGroup(context: ExecutionContext, resolvedInputs: Record<string, any>) {
  const rawPath = resolvedInputs.group_path
  if (typeof rawPath === 'string' && rawPath.trim().length > 0) {
    const resolved = GroupPathService.resolveOrCreate(rawPath)
    return { groupId: resolved.groupId, source: 'node' as const, path: resolved.path }
  }

  if (context.outputGroupId) {
    return { groupId: context.outputGroupId, source: 'execution' as const, path: GroupPathService.getPathLabel(context.outputGroupId) }
  }

  return { groupId: null, source: null, path: null }
}

/** Register one upstream artifact as an explicit workflow final result. */
export async function executeFinalResultNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
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

  const targetGroup = resolveFinalResultGroup(context, resolvedInputs)

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
    groupId: targetGroup.groupId,
  })
  const canonicalReplacementResult = await replacePromotedFinalResultSourceWithCanonicalMedia(sourceArtifact, promotionResult)

  // 대기열 생성 노드의 이미지는 이미 라이브러리에 있어 승격을 건너뛰므로(already_uploaded) 여기서 직접 넣는다.
  // 승격된 경우는 history 의 assigned_group_id 로 이미 들어가 있어 중복 추가는 무시된다.
  const groupAssignedCount = targetGroup.groupId && promotionResult.compositeHash
    ? assignGeneratedMediaToGroup(targetGroup.groupId, [promotionResult.compositeHash])
    : 0

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
      targetGroup: targetGroup.groupId ? { ...targetGroup, assignedNow: groupAssignedCount } : null,
    },
  })
}
