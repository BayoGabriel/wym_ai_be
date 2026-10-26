import { Router, Request, Response } from 'express';
import { checkDbConnection } from '../database/client';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const dbUp = await checkDbConnection();
  res.json({ status: 'ok', db: dbUp ? 'up' : 'down' });
});

export default router;
