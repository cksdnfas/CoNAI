import { Router, Request, Response } from 'express';
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

export { router as customDropdownListRoutes };
