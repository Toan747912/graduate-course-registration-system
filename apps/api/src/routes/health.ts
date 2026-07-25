import { Router } from 'express';
import { sendSuccess } from '../utils/response.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  sendSuccess(res, { status: 'ok', service: 'gcrs-api' });
});
