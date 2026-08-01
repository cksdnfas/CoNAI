import { ThumbnailRegenerationService, type ThumbnailRegenerationResult } from '../../thumbnailRegenerationService'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

/**
 * 썸네일 재생성 잡.
 *
 * 이관 전에는 라우트가 promise 를 버리고 200을 돌려줘 **시작한 클라이언트가 항상 성공으로 인지**했고,
 * 진행률은 static 변수에 있다가 5초 뒤 idle 로 리셋돼 "완료" 와 "시작 안 함" 이 구분되지 않았다.
 * 이제 결과와 실패가 모두 잡 레코드에 남는다.
 */

export type ThumbnailRegenerateJobParams = Record<string, never>

export function registerThumbnailJobHandlers(): void {
  RuntimeJobRunner.register<ThumbnailRegenerateJobParams, ThumbnailRegenerationResult>({
    kind: 'thumbnail-regenerate',
    // 전체 라이브러리를 도는 작업이라 kind 당 1개만 허용한다(부분 유니크 인덱스가 강제).
    singletonKey: () => 'thumbnail-regenerate',
    handler: async (ctx: RuntimeJobContext<ThumbnailRegenerateJobParams>) =>
      ThumbnailRegenerationService.regenerateAllThumbnails(ctx),
  })
}
