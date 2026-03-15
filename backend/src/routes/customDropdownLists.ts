import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { CustomDropdownListModel } from '../models/CustomDropdownList';
import { asyncHandler } from '../middleware/errorHandler';

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
 * 특정 커스텀 드롭다운 목록 조회 (이름)
 * GET /api/custom-dropdown-lists/by-name/:name
 */
router.get('/by-name/:name', asyncHandler(async (req: Request, res: Response) => {
  const name = routeParam(routeParam(req.params.name));

  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'List name is required'
    } as ApiResponse);
  }

  try {
    const list = await CustomDropdownListModel.findByName(name);

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
    console.error('Error getting custom dropdown list by name:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to get custom dropdown list'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 특정 커스텀 드롭다운 목록 조회 (ID)
 * GET /api/custom-dropdown-lists/:id
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

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
  const id = parseInt(routeParam(routeParam(req.params.id)));
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
  const id = parseInt(routeParam(routeParam(req.params.id)));

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
 * ComfyUI 모델 수집 (프론트엔드 기반)
 * POST /api/custom-dropdown-lists/scan-comfyui-models
 */
router.post('/scan-comfyui-models', asyncHandler(async (req: Request, res: Response) => {
  const { modelFolders, sourcePath, mergeSubfolders, createBoth } = req.body;

  // modelFolders: Array<{ folderName: string; displayName: string; files: string[] }>
  // sourcePath: string (optional, for tracking rescan)
  // mergeSubfolders: boolean (하위폴더를 하나로 통합)
  // createBoth: boolean (통합 리스트와 개별 리스트 모두 생성)

  if (!modelFolders || !Array.isArray(modelFolders)) {
    return res.status(400).json({
      success: false,
      error: '모델 폴더 데이터가 필요합니다.'
    } as ApiResponse);
  }

  try {
    let deletedCount = 0;

    // 재스캔인 경우 - 같은 경로로 수집된 기존 항목 삭제
    if (sourcePath) {
      deletedCount = await CustomDropdownListModel.deleteBySourcePath(sourcePath);
      if (deletedCount > 0) {
        console.log(`Rescanning: Deleted ${deletedCount} existing lists from ${sourcePath}`);
      }
    }

    let createdCount = 0;

    // 통합 옵션이 활성화된 경우 - 같은 루트 폴더끼리 병합
    if (mergeSubfolders) {
      // 루트 폴더별로 그룹화 (예: checkpoints, unet, upscale_models)
      const rootFolderMap = new Map<string, string[]>();

      for (const folder of modelFolders) {
        const rootFolder = folder.folderName; // checkpoints, unet 등
        if (!rootFolderMap.has(rootFolder)) {
          rootFolderMap.set(rootFolder, []);
        }

        // 파일 경로에 하위폴더 정보 포함하여 통합
        // displayName: "checkpoints/SD1.5" → subPath: "SD1.5"
        const subPath = folder.displayName.includes('/')
          ? folder.displayName.split('/').slice(1).join('/') + '/'
          : '';

        for (const file of folder.files) {
          // 이미 상대경로가 포함된 경우 그대로 사용, 아니면 subPath 추가
          const fullPath = file.includes('/') ? file : subPath + file;
          rootFolderMap.get(rootFolder)!.push(fullPath);
        }
      }

      // 통합 리스트 생성
      for (const [rootFolder, files] of Array.from(rootFolderMap.entries())) {
        if (files.length > 0) {
          try {
            await CustomDropdownListModel.create({
              name: rootFolder,
              description: `ComfyUI ${rootFolder} 통합 모델 목록 (자동 수집)`,
              items: files.sort(),
              is_auto_collected: 1,
              source_path: sourcePath || 'client-selected'
            });
            createdCount++;
          } catch (error) {
            console.error(`Error creating merged list for ${rootFolder}:`, error);
          }
        }
      }

      // 둘 다 생성 옵션이면 개별 리스트도 추가 생성
      if (createBoth) {
        for (const folder of modelFolders) {
          // 루트 폴더와 이름이 다른 경우만 (하위폴더가 있는 경우)
          if (folder.displayName !== folder.folderName && folder.files && folder.files.length > 0) {
            try {
              await CustomDropdownListModel.create({
                name: folder.displayName,
                description: `ComfyUI ${folder.folderName} 모델 목록 (자동 수집)`,
                items: folder.files,
                is_auto_collected: 1,
                source_path: sourcePath || 'client-selected'
              });
              createdCount++;
            } catch (error) {
              console.error(`Error creating list for ${folder.displayName}:`, error);
            }
          }
        }
      }
    } else {
      // 기존 동작: 폴더별로 개별 목록 생성
      for (const folder of modelFolders) {
        if (folder.files && folder.files.length > 0) {
          try {
            await CustomDropdownListModel.create({
              name: folder.displayName,
              description: `ComfyUI ${folder.folderName} 모델 목록 (자동 수집)`,
              items: folder.files,
              is_auto_collected: 1,
              source_path: sourcePath || 'client-selected'
            });
            createdCount++;
          } catch (error) {
            console.error(`Error creating list for ${folder.displayName}:`, error);
          }
        }
      }
    }

    const response: ApiResponse = {
      success: true,
      data: {
        scannedFolders: modelFolders.length,
        createdLists: createdCount,
        isRescan: deletedCount > 0,
        mergeSubfolders: !!mergeSubfolders,
        message: deletedCount > 0
          ? `${createdCount}개 목록이 업데이트되었습니다.`
          : `${createdCount}개 목록이 생성되었습니다.`
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error processing ComfyUI models:', error);
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process ComfyUI models'
    };
    return res.status(500).json(response);
  }
}));

export { router as customDropdownListRoutes };
