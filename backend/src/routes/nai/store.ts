import { Router, type Request, type Response } from 'express';
import {
  deleteNaiCharacterReferenceAsset,
  deleteNaiVibeAsset,
  getNaiVibeAsset,
  listNaiCharacterReferenceAssets,
  listNaiVibeAssets,
  saveNaiCharacterReferenceAsset,
  saveNaiVibeAsset,
  updateNaiCharacterReferenceAsset,
  updateNaiVibeAsset,
} from '../../services/naiAssetStore';

const router = Router();

router.get('/vibes', async (req: Request<{}, {}, {}, { model?: string }>, res: Response) => {
  const items = await listNaiVibeAssets(req.query.model);
  res.json({ items: items.map(({ encoded, ...item }) => item) });
});

router.get('/vibes/:assetId', async (req: Request<{ assetId: string }>, res: Response) => {
  const item = await getNaiVibeAsset(req.params.assetId);
  if (!item) {
    res.status(404).json({ error: 'Stored vibe not found' });
    return;
  }

  res.json(item);
});

router.post('/vibes', async (req: Request<{}, {}, {
  label?: string;
  description?: string;
  model?: string;
  image?: string;
  encoded?: string;
  strength?: number;
  information_extracted?: number;
}>, res: Response) => {
  const model = req.body.model?.trim();
  const encoded = req.body.encoded?.trim();

  if (!model) {
    res.status(400).json({ error: 'model is required' });
    return;
  }

  if (!encoded) {
    res.status(400).json({ error: 'encoded is required' });
    return;
  }

  const item = await saveNaiVibeAsset({
    label: req.body.label,
    description: req.body.description,
    model,
    image: req.body.image,
    encoded,
    strength: req.body.strength,
    information_extracted: req.body.information_extracted,
  });

  res.status(201).json(item);
});

router.delete('/vibes/:assetId', (req: Request<{ assetId: string }>, res: Response) => {
  const deleted = deleteNaiVibeAsset(req.params.assetId);
  if (!deleted) {
    res.status(404).json({ error: 'Stored vibe not found' });
    return;
  }

  res.json({ success: true });
});

router.put('/vibes/:assetId', async (req: Request<{ assetId: string }, {}, {
  label?: string;
  description?: string;
}>, res: Response) => {
  const label = req.body.label?.trim();
  if (!label) {
    res.status(400).json({ error: 'label is required' });
    return;
  }

  const item = await updateNaiVibeAsset(req.params.assetId, {
    label,
    description: req.body.description,
  });

  if (!item) {
    res.status(404).json({ error: 'Stored vibe not found' });
    return;
  }

  res.json(item);
});

router.get('/character-references', async (_req: Request, res: Response) => {
  res.json({ items: await listNaiCharacterReferenceAssets() });
});

router.post('/character-references', async (req: Request<{}, {}, {
  label?: string;
  description?: string;
  image?: string;
  type?: 'character' | 'style' | 'character&style';
  strength?: number;
  fidelity?: number;
}>, res: Response) => {
  const image = req.body.image?.trim();
  if (!image) {
    res.status(400).json({ error: 'image is required' });
    return;
  }

  const item = await saveNaiCharacterReferenceAsset({
    label: req.body.label,
    description: req.body.description,
    image,
    type: req.body.type,
    strength: req.body.strength,
    fidelity: req.body.fidelity,
  });

  res.status(201).json(item);
});

router.delete('/character-references/:assetId', (req: Request<{ assetId: string }>, res: Response) => {
  const deleted = deleteNaiCharacterReferenceAsset(req.params.assetId);
  if (!deleted) {
    res.status(404).json({ error: 'Stored character reference not found' });
    return;
  }

  res.json({ success: true });
});

router.put('/character-references/:assetId', async (req: Request<{ assetId: string }, {}, {
  label?: string;
  description?: string;
}>, res: Response) => {
  const label = req.body.label?.trim();
  if (!label) {
    res.status(400).json({ error: 'label is required' });
    return;
  }

  const item = await updateNaiCharacterReferenceAsset(req.params.assetId, {
    label,
    description: req.body.description,
  });

  if (!item) {
    res.status(404).json({ error: 'Stored character reference not found' });
    return;
  }

  res.json(item);
});

export default router;
