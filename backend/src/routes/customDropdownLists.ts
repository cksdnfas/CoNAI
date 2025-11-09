import { Router, Request, Response } from 'express';
import { CustomDropdownListModel } from '../models/CustomDropdownList';
import { asyncHandler } from '../middleware/errorHandler';
import * as fs from 'fs/promises';
import * as path from 'path';

const router = Router();

interface ApiResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * 모든 커스텀 드롭다운 목록 조회
 * GET /api/custom-dropdown-lists
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const lists = await CustomDropdownListModel.findAll();

    const response: ApiResponse = {
      success: true,
      data: lists
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting custom dropdown lists:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to get custom dropdown lists'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 특정 커스텀 드롭다운 목록 조회
 * GET /api/custom-dropdown-lists/:id
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid list ID'
    } as ApiResponse);
  }

  try {
    const list = await CustomDropdownListModel.findById(id);

    if (!list) {
      return res.status(404).json({
        success: false,
        error: 'List not found'
      } as ApiResponse);
    }

    const response: ApiResponse = {
      success: true,
      data: list
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting custom dropdown list:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to get custom dropdown list'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 새 커스텀 드롭다운 목록 생성
 * POST /api/custom-dropdown-lists
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, items } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'Name is required'
    } as ApiResponse);
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Items array is required and must not be empty'
    } as ApiResponse);
  }

  try {
    // 이름 중복 확인
    const exists = await CustomDropdownListModel.existsByName(name);
    if (exists) {
      return res.status(409).json({
        success: false,
        error: 'List name already exists'
      } as ApiResponse);
    }

    const listData = {
      name,
      description,
      items
    };

    const listId = await CustomDropdownListModel.create(listData);

    const response: ApiResponse = {
      success: true,
      data: {
        id: listId,
        message: 'Custom dropdown list created successfully'
      }
    };

    return res.status(201).json(response);
  } catch (error) {
    console.error('Error creating custom dropdown list:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to create custom dropdown list'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 커스텀 드롭다운 목록 업데이트
 * PUT /api/custom-dropdown-lists/:id
 */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { name, description, items } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid list ID'
    } as ApiResponse);
  }

  if (items !== undefined && (!Array.isArray(items) || items.length === 0)) {
    return res.status(400).json({
      success: false,
      error: 'Items must be a non-empty array'
    } as ApiResponse);
  }

  try {
    // 자동 수집된 항목인지 확인
    const existingList = await CustomDropdownListModel.findById(id);
    if (!existingList) {
      return res.status(404).json({
        success: false,
        error: 'List not found'
      } as ApiResponse);
    }

    if (existingList.is_auto_collected) {
      return res.status(403).json({
        success: false,
        error: '자동 수집된 항목은 수정할 수 없습니다. 재스캔을 사용하세요.'
      } as ApiResponse);
    }

    // 이름 중복 확인 (변경하는 경우)
    if (name) {
      const exists = await CustomDropdownListModel.existsByName(name, id);
      if (exists) {
        return res.status(409).json({
          success: false,
          error: 'List name already exists'
        } as ApiResponse);
      }
    }

    const listData = {
      name,
      description,
      items
    };

    const updated = await CustomDropdownListModel.update(id, listData);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'List not found'
      } as ApiResponse);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Custom dropdown list updated successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error updating custom dropdown list:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to update custom dropdown list'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 커스텀 드롭다운 목록 삭제
 * DELETE /api/custom-dropdown-lists/:id
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid list ID'
    } as ApiResponse);
  }

  try {
    const deleted = await CustomDropdownListModel.delete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'List not found'
      } as ApiResponse);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Custom dropdown list deleted successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error deleting custom dropdown list:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to delete custom dropdown list'
    };
    return res.status(500).json(response);
  }
}));

/**
 * ComfyUI 모델 폴더 스캔
 * POST /api/custom-dropdown-lists/scan-comfyui-models
 */
router.post('/scan-comfyui-models', asyncHandler(async (req: Request, res: Response) => {
  const { modelsPath } = req.body;

  if (!modelsPath) {
    return res.status(400).json({
      success: false,
      error: 'models 경로가 필요합니다.'
    } as ApiResponse);
  }

  try {
    // 경로 존재 확인
    try {
      await fs.access(modelsPath);
    } catch {
      return res.status(400).json({
        success: false,
        error: '지정된 경로에 접근할 수 없습니다.'
      } as ApiResponse);
    }

    // 재스캔 - 같은 경로로 수집된 기존 항목 삭제
    const deletedCount = await CustomDropdownListModel.deleteBySourcePath(modelsPath);
    if (deletedCount > 0) {
      console.log(`Rescanning: Deleted ${deletedCount} existing lists from ${modelsPath}`);
    }

    // 스캔할 기본 폴더 목록
    const targetFolders = ['checkpoints', 'unet', 'upscale_models'];

    // 모델 파일 확장자
    const modelExtensions = ['.safetensors', '.ckpt', '.pt', '.pth', '.bin'];

    interface ModelFolder {
      folderName: string;
      displayName: string;
      files: string[];
    }

    const result: ModelFolder[] = [];

    // 각 대상 폴더 스캔
    for (const folder of targetFolders) {
      const folderPath = path.join(modelsPath, folder);

      try {
        await fs.access(folderPath);
      } catch {
        // 폴더가 없으면 스킵
        continue;
      }

      // 재귀적으로 폴더 스캔
      const scannedFolders = await scanFolderRecursively(folderPath, '', folder, modelExtensions);
      result.push(...scannedFolders);
    }

    // 스캔된 폴더별로 자동 수집 목록 생성
    let createdCount = 0;
    for (const folder of result) {
      if (folder.files.length > 0) {
        try {
          await CustomDropdownListModel.create({
            name: folder.displayName,
            description: `ComfyUI ${folder.folderName} 모델 목록 (자동 수집)`,
            items: folder.files,
            is_auto_collected: 1,
            source_path: modelsPath
          });
          createdCount++;
        } catch (error) {
          console.error(`Error creating list for ${folder.displayName}:`, error);
        }
      }
    }

    const response: ApiResponse = {
      success: true,
      data: {
        scannedFolders: result.length,
        createdLists: createdCount,
        isRescan: deletedCount > 0,
        message: deletedCount > 0
          ? `${createdCount}개 목록이 업데이트되었습니다.`
          : `${createdCount}개 목록이 생성되었습니다.`
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error scanning ComfyUI models:', error);
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to scan ComfyUI models'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 폴더를 재귀적으로 스캔하여 모델 파일 수집
 */
async function scanFolderRecursively(
  currentPath: string,
  relativePath: string,
  baseFolderName: string,
  modelExtensions: string[]
): Promise<Array<{ folderName: string; displayName: string; files: string[] }>> {
  const results: Array<{ folderName: string; displayName: string; files: string[] }> = [];
  const files: string[] = [];

  try {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // 하위 폴더 재귀 스캔
        const subRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const subResults = await scanFolderRecursively(fullPath, subRelativePath, baseFolderName, modelExtensions);
        results.push(...subResults);
      } else if (entry.isFile()) {
        // 모델 파일인지 확인
        const ext = path.extname(entry.name).toLowerCase();
        if (modelExtensions.includes(ext)) {
          files.push(entry.name);
        }
      }
    }

    // 현재 폴더에 파일이 있으면 결과에 추가
    if (files.length > 0) {
      const displayName = relativePath
        ? `${baseFolderName}/${relativePath}`
        : baseFolderName;

      results.push({
        folderName: baseFolderName,
        displayName,
        files: files.sort()
      });
    }
  } catch (error) {
    console.error(`Error scanning folder ${currentPath}:`, error);
  }

  return results;
}

export { router as customDropdownListRoutes };
