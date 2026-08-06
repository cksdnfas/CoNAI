import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-minimax-director-'));
  process.env.RUNTIME_BASE_PATH = runtimeRoot;

  const [{ prepareComfyPromptData }, assetStore, { ComfyUINodeValidationError }, { substituteComfyPromptData }] = await Promise.all([
    import('../services/prepareComfyPromptData'),
    import('../services/workflowInputAssetStore'),
    import('../services/comfyuiService'),
    import('../services/comfyui/workflowSubstitution'),
  ]);

  try {
    const temporaryAsset = path.join(runtimeRoot, 'opening.png');
    fs.writeFileSync(temporaryAsset, Buffer.from('director-contract'));
    const asset = assetStore.storeWorkflowInputAssetFile(temporaryAsset, {
      fileName: 'opening.png',
      mimeType: 'image/png',
      bytes: 17,
    });

    const uploads: string[] = [];
    const comfyService = {
      uploadInputImage: async (fileName: string, input: Buffer | NodeJS.ReadableStream) => {
        uploads.push(fileName);
        if (!Buffer.isBuffer(input)) {
          for await (const _chunk of input) {
            // Consume the upload stream before the disposable runtime directory is removed.
          }
        }
        return `conai/${fileName}`;
      },
    };
    const promptData = {
      director: {
        mode: 'FL2VA',
        prompt: 'global prompt',
        width: 1344,
        height: 768,
        duration: 5,
        ref_image_size: 'match',
        timeline_data: JSON.stringify({
          version: 1,
          items: [
            { id: 'opening', type: 'image', value: 'opening.png', enabled: true, order: 0, slot: 0 },
            { id: 'hidden-audio', type: 'audio', value: 'hidden.wav', enabled: true, order: 1, slot: 0 },
          ],
          prompt_blocks: [],
        }),
        fl2va_model: ['10', 0],
        ref2va_model: ['11', 0],
        future_input: 'retained',
        __conai_minimax_h3_director: { assets: { opening: asset } },
      },
    };
    const fields = [{
      id: 'director',
      label: 'MiniMax H3 Director',
      type: 'node',
      node_editor: 'minimax_h3_director_dasiwa',
      jsonPath: '42.inputs',
    }];

    const prepared = await prepareComfyPromptData(comfyService as never, fields as never, promptData);
    const nodeValue = prepared.director;
    const timeline = JSON.parse(nodeValue.timeline_data);
    assert.equal(uploads.length, 1, 'FL2VA must upload only its active image references');
    assert.match(timeline.items[0].value, /^conai\//, 'the standard Comfy upload result must replace the draft filename');
    assert.equal(timeline.items[1].value, 'hidden.wav', 'REF-only media must survive an FL2VA submission unchanged');
    assert.deepEqual(nodeValue.fl2va_model, ['10', 0], 'FL2VA MODEL links must remain untouched');
    assert.deepEqual(nodeValue.ref2va_model, ['11', 0], 'REF2VA MODEL links must remain untouched');
    assert.equal(nodeValue.future_input, 'retained', 'unknown node inputs must remain untouched');
    assert.equal('__conai_minimax_h3_director' in nodeValue, false, 'CoNAI-only draft metadata must never reach ComfyUI');
    const substituted = substituteComfyPromptData(
      JSON.stringify({ '42': { class_type: 'MiniMaxH3Director', inputs: promptData.director } }),
      fields as never,
      prepared,
    );
    assert.equal(substituted['42'].class_type, 'MiniMaxH3Director', 'Director execution must use the ordinary workflow node');
    assert.deepEqual(substituted['42'].inputs, nodeValue, 'the prepared composite value must use ordinary workflow substitution');

    const nodeError = new ComfyUINodeValidationError({
      '42': {
        class_type: 'MiniMaxH3Director',
        errors: [{ message: 'Required input is missing', extra_info: { input_name: 'ref2va_model' } }],
      },
    });
    assert.match(nodeError.queueFailureMessage, /node 42 \(MiniMaxH3Director\) input ref2va_model/, 'Comfy validation messages must identify the Director node and input');

    const routeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/startup/registerAppRoutes.ts'), 'utf8');
    assert.match(
      routeSource,
      /options\.uploadLimiter, requireAuth, workflowInputAssetRoutes/,
      'private Director media routes must be authenticated and upload-limited',
    );
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }

  console.log('MiniMax H3 Director backend contracts verified');
}

void main();
