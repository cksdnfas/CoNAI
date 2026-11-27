import type { RequestHandler } from 'express';
import { WorkflowModel } from '../models/Workflow';

/**
 * A published workflow's page grants the inputs it needs, as its queue route does. A request scoped to an existing
 * public workflow (?publicWorkflow=slug) needs no read right, which would open the whole library. Without a valid
 * slug the guard applies unchanged.
 */
export const orPublicWorkflow = (guard: RequestHandler): RequestHandler => (req, res, next) => {
  const slug = req.query.publicWorkflow;
  if (typeof slug === 'string' && WorkflowModel.findPublicBySlug(slug.trim().toLowerCase())) {
    next();
    return;
  }
  guard(req, res, next);
};
