import { z } from 'zod';
import { GenerationTargetGroupService } from '../../services/generationTargetGroupService';

export const MCP_GROUP_PATH_DESCRIPTION =
  "Optional image group path such as 'ProjectName/Effects'. Missing groups are created under their parent "
  + '(names are compared case-insensitively among siblings, max 5 levels). Use instead of group_id.';

export const mcpGroupPathSchema = z.string().trim().min(1).max(1024).optional().describe(MCP_GROUP_PATH_DESCRIPTION);

/**
 * MCP 생성 도구의 group_id / group_path 입력을 그룹 id 로 확정한다.
 * 도구 scope 와 연결 계정의 기능 권한은 MCP 등록/실행 경계에서 확인하며, 여기서는 그룹 입력만 해석한다.
 * 잘못된 입력이면 Error 를 던져 도구가 isError 로 응답하게 한다.
 */
export function resolveMcpTargetGroup(groupId: number | null | undefined, groupPath: string | null | undefined): number | undefined {
  const resolved = GenerationTargetGroupService.resolve({ groupId, groupPath });
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  return resolved.groupId ?? undefined;
}
