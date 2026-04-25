import { Router, type Request, type Response } from 'express'
import { GraphWorkflowFolderModel } from '../../models/GraphWorkflowFolder'
import { asyncHandler } from '../../middleware/errorHandler'
import { sendRouteBadRequest } from '../routeValidation'
import type { ModuleGraphResponse } from '../../types/moduleGraph'
import { findGraphWorkflowFolderOrRespond, parseRequiredGraphRouteId } from './route-helpers'

export function createGraphWorkflowFolderRoutes() {
  const router = Router()

  router.get('/folders', asyncHandler(async (_req: Request, res: Response) => {
    try {
      const folders = GraphWorkflowFolderModel.findAll()
      return res.json({ success: true, data: folders } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph workflow folders:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph workflow folders' } as ModuleGraphResponse)
    }
  }))

  router.post('/folders', asyncHandler(async (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : ''
    const parentId = typeof req.body?.parent_id === 'number' ? req.body.parent_id : null

    if (!name) {
      return sendRouteBadRequest(res, 'name is required')
    }

    if (parentId !== null && !findGraphWorkflowFolderOrRespond(res, parentId, 'Parent folder not found')) {
      return
    }

    try {
      const id = GraphWorkflowFolderModel.create({ name, description: description || null, parent_id: parentId })
      return res.status(201).json({ success: true, data: { id, message: 'Graph workflow folder created successfully' } } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error creating graph workflow folder:', error)
      return res.status(500).json({ success: false, error: 'Failed to create graph workflow folder' } as ModuleGraphResponse)
    }
  }))

  router.put('/folders/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = parseRequiredGraphRouteId(res, req.params.id, 'Invalid folder ID')
    if (id === null) {
      return
    }

    const existingFolder = findGraphWorkflowFolderOrRespond(res, id)
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : undefined
    const parentId = typeof req.body?.parent_id === 'number' ? req.body.parent_id : req.body?.parent_id === null ? null : undefined

    if (!existingFolder) {
      return
    }

    if (name !== undefined && !name) {
      return sendRouteBadRequest(res, 'name is required')
    }

    if (parentId !== undefined) {
      if (parentId === id) {
        return sendRouteBadRequest(res, 'Folder cannot be its own parent')
      }
      if (parentId !== null && !findGraphWorkflowFolderOrRespond(res, parentId, 'Parent folder not found')) {
        return
      }
    }

    try {
      const updated = GraphWorkflowFolderModel.update(id, {
        name,
        description: description === undefined ? undefined : description || null,
        parent_id: parentId,
      })
      if (!updated) {
        return sendRouteBadRequest(res, 'No folder changes detected')
      }

      return res.json({ success: true, data: { message: 'Graph workflow folder updated successfully' } } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error updating graph workflow folder:', error)
      return res.status(500).json({ success: false, error: 'Failed to update graph workflow folder' } as ModuleGraphResponse)
    }
  }))

  router.delete('/folders/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = parseRequiredGraphRouteId(res, req.params.id, 'Invalid folder ID')
    const deleteMode = req.query.mode === 'delete_tree' ? 'delete_tree' : 'move_children'

    if (id === null) {
      return
    }

    if (!findGraphWorkflowFolderOrRespond(res, id)) {
      return
    }

    try {
      const deleted = GraphWorkflowFolderModel.delete(id, deleteMode)
      if (!deleted) {
        return res.status(500).json({ success: false, error: 'Failed to delete graph workflow folder' } as ModuleGraphResponse)
      }

      return res.json({ success: true, data: { message: deleteMode === 'delete_tree' ? 'Graph workflow folder tree deleted successfully' : 'Graph workflow folder deleted and children moved successfully' } } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error deleting graph workflow folder:', error)
      return res.status(500).json({ success: false, error: 'Failed to delete graph workflow folder' } as ModuleGraphResponse)
    }
  }))

  return router
}
