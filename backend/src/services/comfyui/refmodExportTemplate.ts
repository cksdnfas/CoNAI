import { MINIMAX_H3_REFMOD_CONCEPT_TYPES, MINIMAX_H3_REFMOD_EXPORT_CLASS_TYPE } from '@conai/shared';
import type { MarkedField, WorkflowCreateData } from '../../types/workflow';

export function buildRefModExportTemplate(options: { vaeNames?: string[] | null; endpoint?: string } = {}): WorkflowCreateData {
  const director = {
    mode: 'REF2VA', prompt: '', width: 1344, height: 768, duration: 5,
    frame_rate: 24, ref_image_size: 'match', timeline_data: '{"items":[]}', builder_state: '',
  };
  const vaeFields: MarkedField[] = ['2', '3'].map((nodeId, index) => ({
    id: index === 0 ? 'video_vae' : 'audio_vae',
    label: index === 0 ? 'Video VAE' : 'Audio VAE',
    type: options.vaeNames?.length ? 'select' : 'text',
    jsonPath: `${nodeId}.inputs.vae_name`, default_value: '', required: true,
    ...(options.vaeNames?.length ? { options: options.vaeNames } : {}),
    description: `Select the MiniMax H3 ${index === 0 ? 'video' : 'audio'} VAE installed on the target ComfyUI server.${options.vaeNames?.length ? '' : ' Enter the exact VAELoader vae_name; server options were not available.'}`,
  }));
  return {
    name: 'MiniMax H3 RefMod 생성',
    description: 'Create a DaSiWa RefMod bundle and retain its source media in CoNAI. Select both H3 VAEs before running.',
    api_endpoint: options.endpoint,
    workflow_json: JSON.stringify({
      1: { class_type: 'MiniMaxH3Director', inputs: director },
      2: { class_type: 'VAELoader', inputs: { vae_name: '' } },
      3: { class_type: 'VAELoader', inputs: { vae_name: '' } },
      4: { class_type: MINIMAX_H3_REFMOD_EXPORT_CLASS_TYPE, inputs: {
        timeline_data: '', request_id: '', name: '', description: '', concept_type: 'generic',
        vae: ['2', 0], audio_vae: ['3', 0],
      } },
    }),
    marked_fields: [
      {
        id: 'director', label: 'RefMod sources', type: 'node', node_editor: 'minimax_h3_director_dasiwa',
        node_class_type: 'MiniMaxH3Director', jsonPath: '1.inputs', default_value: director,
        node_visible_fields: ['mode', 'timeline_data'],
        node_hidden_controls: ['resolution', 'resolution.input_scaling', 'postprocess.simple', 'postprocess.model', 'postprocess.model.model_name', 'postprocess.rtx'],
      },
      { id: 'name', label: 'RefMod name', type: 'text', jsonPath: '4.inputs.name', default_value: '', description: 'Leave empty for an automatic director-<uuid> name.' },
      { id: 'description', label: 'Description', type: 'textarea', jsonPath: '4.inputs.description', default_value: '' },
      { id: 'concept_type', label: 'Concept', type: 'select', jsonPath: '4.inputs.concept_type', options: [...MINIMAX_H3_REFMOD_CONCEPT_TYPES], default_value: 'generic' },
      ...vaeFields,
    ],
  };
}
