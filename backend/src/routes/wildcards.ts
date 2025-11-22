import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { WildcardModel, WildcardCreateData, WildcardUpdateData } from '../models/Wildcard';
import { WildcardService } from '../services/wildcardService';
import fs from 'fs';
import path from 'path';

const router = Router();

/**
 * 모든 와일드카드 조회
 * GET /api/wildcards
 * Query params:
 *   - withItems: 'true' | 'false' (default: 'true')
 *   - hierarchical: 'true' | 'false' (default: 'false') - 계층 구조로 반환
 *   - rootsOnly: 'true' | 'false' (default: 'false') - 루트 와일드카드만
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const withItems = req.query.withItems !== 'false';
    const hierarchical = req.query.hierarchical === 'true';
    const rootsOnly = req.query.rootsOnly === 'true';

    let wildcards;
    if (hierarchical) {
      wildcards = WildcardModel.findHierarchy(null);
    } else if (rootsOnly) {
      wildcards = WildcardModel.findRoots();
    } else if (withItems) {
      wildcards = WildcardModel.findAllWithItems();
    } else {
      wildcards = WildcardModel.findAll();
    }

    return res.json({
      success: true,
      data: wildcards
    });
  } catch (error) {
    console.error('Error getting wildcards:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get wildcards'
    });
  }
}));

/**
 * 마지막 LORA 스캔 로그 조회
 * GET /api/wildcards/last-scan-log
 */
router.get('/last-scan-log', asyncHandler(async (req: Request, res: Response) => {
  try {
    const db = (await import('../database/userSettingsDb')).getUserSettingsDb();
    const result = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get('last_lora_scan_log') as any;

    if (!result) {
      return res.json({
        success: true,
        data: null
      });
    }

    return res.json({
      success: true,
      data: JSON.parse(result.value)
    });
  } catch (error) {
    console.error('Error getting last scan log:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get last scan log'
    });
  }
}));

/**
 * 특정 와일드카드의 자식 조회
 * GET /api/wildcards/:id/children
 */
router.get('/:id/children', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const children = WildcardModel.findByParentId(id);
    return res.json({
      success: true,
      data: children
    });
  } catch (error) {
    console.error('Error getting wildcard children:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get wildcard children'
    });
  }
}));

/**
 * 특정 와일드카드의 전체 경로 조회 (루트부터 현재까지)
 * GET /api/wildcards/:id/path
 */
router.get('/:id/path', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const path = WildcardModel.getFullPath(id);
    return res.json({
      success: true,
      data: path
    });
  } catch (error) {
    console.error('Error getting wildcard path:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get wildcard path'
    });
  }
}));

/**
 * 특정 와일드카드 조회
 * GET /api/wildcards/:id
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const wildcard = WildcardModel.findByIdWithItems(id);

    if (!wildcard) {
      return res.status(404).json({
        success: false,
        error: 'Wildcard not found'
      });
    }

    return res.json({
      success: true,
      data: wildcard
    });
  } catch (error) {
    console.error('Error getting wildcard:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get wildcard'
    });
  }
}));

/**
 * 와일드카드 생성
 * POST /api/wildcards
 * Body: WildcardCreateData
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const data: WildcardCreateData = req.body;

    // 유효성 검증
    if (!data.name || typeof data.name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      });
    }

    // 항목 유효성 검증 (적어도 하나의 도구에 항목이 있어야 함)
    if (!data.items || typeof data.items !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Items object is required'
      });
    }

    const hasComfyuiItems = Array.isArray(data.items.comfyui) && data.items.comfyui.length > 0;
    const hasNaiItems = Array.isArray(data.items.nai) && data.items.nai.length > 0;

    if (!hasComfyuiItems && !hasNaiItems) {
      return res.status(400).json({
        success: false,
        error: 'At least one item is required for either ComfyUI or NAI'
      });
    }

    // 이름 중복 체크
    const existing = WildcardModel.findByName(data.name);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Wildcard with this name already exists'
      });
    }

    // parent_id 유효성 검증
    if (data.parent_id !== undefined && data.parent_id !== null) {
      const parentWildcard = WildcardModel.findById(data.parent_id);
      if (!parentWildcard) {
        return res.status(400).json({
          success: false,
          error: 'Parent wildcard not found'
        });
      }
    }

    // 생성
    const wildcard = WildcardModel.create(data);
    const wildcardWithItems = WildcardModel.findByIdWithItems(wildcard.id);

    // 순환 참조 검사
    const circularPath = WildcardService.detectCircularReference(wildcard.id);
    if (circularPath) {
      return res.status(201).json({
        success: true,
        data: wildcardWithItems,
        warning: `Circular reference detected: ${circularPath.join(' -> ')}`
      });
    }

    return res.status(201).json({
      success: true,
      data: wildcardWithItems
    });
  } catch (error) {
    console.error('Error creating wildcard:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create wildcard'
    });
  }
}));

/**
 * 와일드카드 수정
 * PUT /api/wildcards/:id
 * Body: WildcardUpdateData
 */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const data: WildcardUpdateData = req.body;

    // 존재 여부 확인
    const existing = WildcardModel.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Wildcard not found'
      });
    }

    // 이름 중복 체크 (이름 변경 시)
    if (data.name && data.name !== existing.name) {
      const duplicate = WildcardModel.findByName(data.name);
      if (duplicate) {
        return res.status(409).json({
          success: false,
          error: 'Wildcard with this name already exists'
        });
      }
    }

    // parent_id 유효성 및 순환 참조 검증
    if (data.parent_id !== undefined && data.parent_id !== null) {
      const parentWildcard = WildcardModel.findById(data.parent_id);
      if (!parentWildcard) {
        return res.status(400).json({
          success: false,
          error: 'Parent wildcard not found'
        });
      }
      // 순환 참조 검사
      if (WildcardModel.checkCircularReference(id, data.parent_id)) {
        return res.status(400).json({
          success: false,
          error: 'Circular parent reference detected'
        });
      }
    }

    // 수정
    const wildcard = WildcardModel.update(id, data);
    const wildcardWithItems = WildcardModel.findByIdWithItems(wildcard.id);

    // 순환 참조 검사
    const circularPath = WildcardService.detectCircularReference(wildcard.id);
    if (circularPath) {
      return res.json({
        success: true,
        data: wildcardWithItems,
        warning: `Circular reference detected: ${circularPath.join(' -> ')}`
      });
    }

    return res.json({
      success: true,
      data: wildcardWithItems
    });
  } catch (error) {
    console.error('Error updating wildcard:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update wildcard'
    });
  }
}));

/**
 * 와일드카드 삭제
 * DELETE /api/wildcards/:id?cascade=true|false
 * Query params:
 *   - cascade: 'true' | 'false' (default: 'false')
 *     true: 모든 하위 와일드카드도 함께 삭제
 *     false: 선택한 와일드카드만 삭제하고 자식들을 한 단계 위로 이동
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const cascade = req.query.cascade === 'true';

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const deleted = WildcardModel.delete(id, cascade);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Wildcard not found'
      });
    }

    return res.json({
      success: true,
      message: cascade
        ? 'Wildcard and all children deleted successfully'
        : 'Wildcard deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting wildcard:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete wildcard'
    });
  }
}));

/**
 * 와일드카드 파싱 (프리뷰용)
 * POST /api/wildcards/parse
 * Body: { text: string, tool: 'comfyui' | 'nai', count?: number }
 */
router.post('/parse', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { text, tool, count = 1 } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    if (!tool || (tool !== 'comfyui' && tool !== 'nai')) {
      return res.status(400).json({
        success: false,
        error: 'Valid tool is required (comfyui or nai)'
      });
    }

    const parsedCount = Math.min(Math.max(parseInt(count) || 1, 1), 10); // 1-10 범위로 제한

    const results = WildcardService.parseMultiple(text, tool, parsedCount);

    return res.json({
      success: true,
      data: {
        original: text,
        results,
        usedWildcards: WildcardService.extractWildcardNames(text)
      }
    });
  } catch (error) {
    console.error('Error parsing wildcards:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to parse wildcards'
    });
  }
}));

/**
 * 와일드카드 통계
 * GET /api/wildcards/statistics
 */
router.get('/stats/summary', asyncHandler(async (req: Request, res: Response) => {
  try {
    const statistics = WildcardService.getStatistics();

    return res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Error getting wildcard statistics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get statistics'
    });
  }
}));

/**
 * 순환 참조 검사
 * GET /api/wildcards/:id/circular-check
 */
router.get('/:id/circular-check', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const wildcard = WildcardModel.findById(id);
    if (!wildcard) {
      return res.status(404).json({
        success: false,
        error: 'Wildcard not found'
      });
    }

    const circularPath = WildcardService.detectCircularReference(id);

    return res.json({
      success: true,
      data: {
        hasCircularReference: circularPath !== null,
        circularPath: circularPath || []
      }
    });
  } catch (error) {
    console.error('Error checking circular reference:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check circular reference'
    });
  }
}));

/**
 * LORA 파일 정보로 와일드카드 자동 생성 (프론트엔드 기반)
 * POST /api/wildcards/scan-lora-folder
 * Body: {
 *   loraFiles: Array<{
 *     folderName: string,
 *     loraName: string,
 *     promptLines: string[]
 *   }>,
 *   loraWeight: number,
 *   duplicateHandling: 'number' | 'parent'
 * }
 */
router.post('/scan-lora-folder', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { loraFiles, loraWeight = 1.0, duplicateHandling = 'number' } = req.body;

    // 유효성 검증
    if (!Array.isArray(loraFiles) || loraFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'LORA files array is required'
      });
    }

    if (typeof loraWeight !== 'number' || loraWeight < 0.1 || loraWeight > 2.0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid lora weight (must be between 0.1 and 2.0)'
      });
    }

    if (duplicateHandling !== 'number' && duplicateHandling !== 'parent') {
      return res.status(400).json({
        success: false,
        error: 'Invalid duplicate handling method'
      });
    }

    // 기존 자동 수집 와일드카드 모두 삭제 (프론트엔드 기반이므로 source_path 없음)
    const db = (await import('../database/userSettingsDb')).getUserSettingsDb();
    db.prepare('DELETE FROM wildcards WHERE is_auto_collected = 1').run();

    // 폴더별로 LORA 파일 그룹화
    interface LoraFileData {
      folderName: string;
      loraName: string;
      promptLines: string[];
    }

    interface FolderGroup {
      folderName: string;
      displayName: string;
      loras: LoraFileData[];
      level: number; // 계층 레벨 (1 = 리프 노드, 2+ = 부모)
      pathParts: string[]; // 전체 경로 파츠
    }

    // 1. LORA 파일이 있는 폴더 그룹화 (리프 노드 = 레벨 1)
    const folderMap = new Map<string, LoraFileData[]>();

    for (const file of loraFiles as LoraFileData[]) {
      if (!folderMap.has(file.folderName)) {
        folderMap.set(file.folderName, []);
      }
      folderMap.get(file.folderName)!.push(file);
    }

    // 리프 노드 폴더들
    const leafFolders: FolderGroup[] = Array.from(folderMap.entries()).map(([folderName, loras]) => ({
      folderName,
      displayName: folderName.split('/').pop() || folderName,
      loras,
      level: 1,
      pathParts: folderName.split('/')
    }));

    // 2. 부모 폴더 추출 (계층 구조 구축)
    const parentFoldersSet = new Set<string>();
    const maxDepth = Math.max(...leafFolders.map(f => f.pathParts.length));

    for (const folder of leafFolders) {
      const parts = folder.pathParts;

      // 상위 경로들을 모두 추출 (리프 노드 제외)
      for (let i = parts.length - 1; i > 0; i--) {
        const parentPath = parts.slice(0, i).join('/');
        parentFoldersSet.add(parentPath);
      }
    }

    // 부모 폴더를 FolderGroup 형태로 변환 및 레벨 계산
    const parentFolders: FolderGroup[] = Array.from(parentFoldersSet).map(parentPath => {
      const parts = parentPath.split('/');
      const level = maxDepth - parts.length + 1;

      return {
        folderName: parentPath,
        displayName: parts[parts.length - 1],
        loras: [],
        level,
        pathParts: parts
      };
    });

    // 3. 레벨별로 정렬 (레벨 1부터 생성)
    const allFolders = [...leafFolders, ...parentFolders].sort((a, b) => a.level - b.level);

    // 4. 와일드카드 생성 (레벨별로, bottom-up)
    const createdWildcards: any[] = [];
    const usedNames = new Set<string>();
    const pathToWildcardName = new Map<string, string>(); // 경로 -> 와일드카드 이름 매핑
    const pathToWildcardId = new Map<string, number>(); // 경로 -> 와일드카드 ID 매핑 (parent_id 설정용)
    const levelCounters = new Map<number, number>(); // 레벨별 카운터

    for (const folder of allFolders) {
      let wildcardName = folder.displayName;

      // 중복 이름 처리
      if (usedNames.has(wildcardName)) {
        if (duplicateHandling === 'number') {
          // 숫자 접미사 추가
          let counter = 2;
          while (usedNames.has(`${wildcardName}_${counter}`)) {
            counter++;
          }
          wildcardName = `${wildcardName}_${counter}`;
        } else {
          // 상위 폴더 포함
          const parts = folder.pathParts;
          if (parts.length > 1) {
            wildcardName = parts[parts.length - 2] + '_' + wildcardName;
          }

          // 여전히 중복이면 숫자 추가
          if (usedNames.has(wildcardName)) {
            let counter = 2;
            while (usedNames.has(`${wildcardName}_${counter}`)) {
              counter++;
            }
            wildcardName = `${wildcardName}_${counter}`;
          }
        }
      }

      usedNames.add(wildcardName);
      pathToWildcardName.set(folder.folderName, wildcardName);

      // 부모 경로 계산 (parent_id 설정용)
      const parentPath = folder.pathParts.length > 1
        ? folder.pathParts.slice(0, -1).join('/')
        : null;

      // ID 생성: 레벨별 카운터
      const currentCounter = (levelCounters.get(folder.level) || 0) + 1;
      levelCounters.set(folder.level, currentCounter);
      const customId = folder.level * 100000 + currentCounter;

      // 와일드카드 항목 생성
      const items: string[] = [];

      if (folder.level === 1) {
        // 레벨 1: LORA 파일 직접 포함
        for (const lora of folder.loras) {
          const loraTag = `<lora:${lora.loraName}:${loraWeight}>`;

          if (lora.promptLines && lora.promptLines.length > 0) {
            // 각 줄마다 별도 항목 생성
            for (const line of lora.promptLines) {
              if (line.trim()) {
                items.push(`${loraTag}, ${line.trim()}`);
              }
            }
          } else {
            // 프롬프트 라인이 없으면 LORA 태그만
            items.push(loraTag);
          }
        }
      } else {
        // 레벨 2+: 자식 와일드카드 참조
        // 현재 폴더의 직접 자식 폴더들 찾기
        const childFolders = allFolders.filter(f => {
          // 자식 조건: pathParts 길이가 현재 + 1이고, 경로가 현재로 시작
          return f.pathParts.length === folder.pathParts.length + 1 &&
                 f.folderName.startsWith(folder.folderName + '/');
        });

        for (const child of childFolders) {
          const childWildcardName = pathToWildcardName.get(child.folderName);
          if (childWildcardName) {
            items.push(`++${childWildcardName}++`);
          }
        }
      }

      // 와일드카드 생성 (항목이 있을 때만)
      if (items.length > 0) {
        const wildcardData: WildcardCreateData = {
          name: wildcardName,
          description: `Auto-generated from ${folder.folderName}`,
          items: {
            comfyui: items,
            nai: []
          },
          customId,
          parent_id: null // 초기에는 null로 생성
        };

        const wildcard = WildcardModel.create(wildcardData);

        // 경로 -> ID 매핑 저장
        pathToWildcardId.set(folder.folderName, wildcard.id);

        // is_auto_collected, lora_weight 설정 (source_path는 null)
        db.prepare(`
          UPDATE wildcards
          SET is_auto_collected = 1, source_path = NULL, lora_weight = ?
          WHERE id = ?
        `).run(loraWeight, wildcard.id);

        createdWildcards.push({
          id: wildcard.id,
          name: wildcardName,
          itemCount: items.length,
          folderName: folder.folderName,
          level: folder.level,
          parentPath // 나중에 parent_id 업데이트용
        });
      }
    }

    // 5. parent_id 설정 (모든 와일드카드 생성 후)
    for (const created of createdWildcards) {
      if (created.parentPath) {
        const parentId = pathToWildcardId.get(created.parentPath);
        if (parentId) {
          db.prepare('UPDATE wildcards SET parent_id = ? WHERE id = ?').run(parentId, created.id);
        }
      }
    }

    // 스캔 로그 저장 (마지막 스캔만 유지)
    db.prepare('DELETE FROM user_preferences WHERE key = ?').run('last_lora_scan_log');

    const scanLog = {
      timestamp: new Date().toISOString(),
      loraWeight,
      duplicateHandling,
      totalWildcards: createdWildcards.length,
      totalItems: createdWildcards.reduce((sum, wc) => sum + wc.itemCount, 0),
      wildcards: createdWildcards
    };

    db.prepare('INSERT INTO user_preferences (key, value) VALUES (?, ?)').run(
      'last_lora_scan_log',
      JSON.stringify(scanLog)
    );

    return res.json({
      success: true,
      data: {
        created: createdWildcards.length,
        log: scanLog
      }
    });
  } catch (error) {
    console.error('Error scanning LORA folder:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to scan LORA folder: ${(error as Error).message}`
    });
  }
}));

export default router;
