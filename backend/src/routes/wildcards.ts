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
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const withItems = req.query.withItems !== 'false';

    const wildcards = withItems
      ? WildcardModel.findAllWithItems()
      : WildcardModel.findAll();

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
 * DELETE /api/wildcards/:id
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const deleted = WildcardModel.delete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Wildcard not found'
      });
    }

    return res.json({
      success: true,
      message: 'Wildcard deleted successfully'
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
    }

    const folderMap = new Map<string, LoraFileData[]>();

    for (const file of loraFiles as LoraFileData[]) {
      if (!folderMap.has(file.folderName)) {
        folderMap.set(file.folderName, []);
      }
      folderMap.get(file.folderName)!.push(file);
    }

    const folderGroups: FolderGroup[] = Array.from(folderMap.entries()).map(([folderName, loras]) => ({
      folderName,
      displayName: folderName.split('/').pop() || folderName,
      loras
    }));

    // 와일드카드 생성
    const createdWildcards: any[] = [];
    const usedNames = new Set<string>();

    for (const folder of folderGroups) {
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
          const parts = folder.folderName.split('/');
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

      // 와일드카드 항목 생성
      const items: string[] = [];

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

      // 와일드카드 생성
      if (items.length > 0) {
        const wildcardData: WildcardCreateData = {
          name: wildcardName,
          description: `Auto-generated from ${folder.folderName}`,
          items: {
            comfyui: items,
            nai: []
          }
        };

        const wildcard = WildcardModel.create(wildcardData);

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
          folderName: folder.folderName
        });
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
