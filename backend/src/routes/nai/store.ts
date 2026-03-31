import { Router, type Request, type Response } from 'express';
import {
  deleteNaiCharacterReferenceAsset,
  deleteNaiVibeAsset,
  listNaiCharacterReferenceAssets,
  listNaiVibeAssets,
  saveNaiCharacterReferenceAsset,
  saveNaiVibeAsset,
} from '../../services/naiAssetStore';

const router = Router();

router.get('/vibes', (req: Request<{}, {}, {}, { model?: string }>, res: Response) => {
  res.json({ items: listNaiVibeAssets(req.query.model) });
});

router.post('/vibes', async (req: Request<{}, {}, {
  label?: string;
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

router.get('/character-references', (_req: Request, res: Response) => {
  res.json({ items: listNaiCharacterReferenceAssets() });
});

router.post('/character-references', async (req: Request<{}, {}, {
  label?: string;
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

export default router;
