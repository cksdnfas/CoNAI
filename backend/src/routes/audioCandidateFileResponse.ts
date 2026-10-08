import type { NextFunction, Request, Response } from 'express';
import type { AudioCandidate } from '../services/audio/audioService';
import { AUDIO_MIME_BY_EXTENSION, audioBlobPath, type AudioFileRecord } from '../services/audio/audioStore';

/**
 * Stream one candidate's sound (audio workspace, generation history). sendFile answers single byte ranges (206/416)
 * and HEAD for seeking players; `?download=1` makes it an attachment.
 */
export function sendAudioCandidateFile(req: Request, res: Response, next: NextFunction, candidate: AudioCandidate, file: AudioFileRecord): void {
  const filePath = audioBlobPath(file.hash, file.ext);
  const safeName = `${candidate.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}.${file.ext}`;
  res.setHeader('Content-Type', AUDIO_MIME_BY_EXTENSION[file.ext] ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.sendFile(filePath, { dotfiles: 'allow' }, (error) => {
    if (!error || res.headersSent) return;
    const status = (error as { status?: number }).status;
    if (status === 416) {
      res.setHeader('Content-Range', `bytes */${file.size}`);
      res.status(416).end();
    } else if (status === 404 || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      res.status(404).json({ success: false, error: '파일이 없어.' });
    } else next(error);
  });
}
