import { Router } from 'express'
import { createGraphWorkflowArtifactRoutes } from './graph-workflows/artifact-routes'
import { createGraphWorkflowCrudRoutes } from './graph-workflows/workflow-routes'
import { createGraphWorkflowExecutionRoutes } from './graph-workflows/execution-routes'
import { createGraphWorkflowFolderRoutes } from './graph-workflows/folder-routes'
import { createGraphWorkflowScheduleRoutes } from './graph-workflows/schedule-routes'

const router = Router()

router.use(createGraphWorkflowFolderRoutes())
router.use(createGraphWorkflowScheduleRoutes())
router.use(createGraphWorkflowExecutionRoutes())
router.use(createGraphWorkflowArtifactRoutes())
router.use(createGraphWorkflowCrudRoutes())

export const graphWorkflowRoutes = router
export default router
