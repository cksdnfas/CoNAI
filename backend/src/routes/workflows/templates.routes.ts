import { Router } from 'express';
import { MINIMAX_H3_REFMOD_EXPORT_TEMPLATE_KEY } from '@conai/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requirePermission } from '../../middleware/authMiddleware';
import { WorkflowModel } from '../../models/Workflow';
import { ComfyUIServerModel, WorkflowServerModel } from '../../models/ComfyUIServer';
import { CustomDropdownListModel } from '../../models/CustomDropdownList';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { buildMergedComfyDropdownListName } from '../../services/comfyDropdownAutoCollectionService';
import { createComfyUIService } from '../../services/comfyuiService';
import { buildRefModExportTemplate } from '../../services/comfyui/refmodExportTemplate';

const router = Router();
router.post(`/templates/${MINIMAX_H3_REFMOD_EXPORT_TEMPLATE_KEY}`, requirePermission('workflows.edit'), asyncHandler(async (req, res) => {
  const serverId = req.body?.server_id;
  if (serverId !== undefined && (!Number.isSafeInteger(serverId) || serverId <= 0)) {
    return res.status(400).json({ success: false, error: 'server_id must be a positive integer' });
  }
  const server = serverId === undefined ? null : ComfyUIServerModel.findById(serverId);
  if (serverId !== undefined && !server) return res.status(404).json({ success: false, error: 'ComfyUI server not found' });
  if (server?.backend_type === 'modal') return res.status(400).json({ success: false, error: 'RefMod creation requires a standard ComfyUI server' });
  const vaeNames = server ? await createComfyUIService(server.endpoint, server).getNodeInputOptions('VAELoader', 'vae_name') : null;
  const vaeDropdownList = CustomDropdownListModel.findByName(buildMergedComfyDropdownListName('vae'));
  const template = buildRefModExportTemplate({
    vaeNames,
    vaeDropdownList: vaeDropdownList?.is_auto_collected ? vaeDropdownList : null,
    endpoint: server?.endpoint,
  });
  // A deleted workflow keeps its unique name but appears in no list, so adding again revives that row with the current template.
  const trashed = WorkflowModel.findDeleted().find((workflow) => workflow.name === template.name);
  if (!trashed && WorkflowModel.existsByName(template.name)) return res.status(409).json({ success: false, error: 'The MiniMax H3 RefMod creation workflow already exists' });
  const id = getUserSettingsDb().transaction(() => {
    if (trashed) {
      WorkflowModel.restore(trashed.id);
      WorkflowModel.update(trashed.id, { ...template, is_active: true });
    }
    const workflowId = trashed ? trashed.id : WorkflowModel.create(template);
    if (server) WorkflowServerModel.linkServer(workflowId, server.id);
    return workflowId;
  })();
  return res.json({ success: true, data: { id } });
}));
export default router;
