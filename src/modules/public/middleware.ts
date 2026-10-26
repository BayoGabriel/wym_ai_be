import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../middleware/error';
import { PublicSessionContext, resolveSessionToken } from './service';

export type PublicSessionRequest = Request & { publicSession?: PublicSessionContext };

export async function authenticatePublicSession(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Missing chat session credential'));
  }
  const token = header.substring('Bearer '.length).trim();
  if (!token || !token.startsWith('wymcs_')) {
    return next(new ApiError(401, 'INVALID_SESSION', 'Chat session is invalid'));
  }
  try {
    (req as PublicSessionRequest).publicSession = await resolveSessionToken(token);
    next();
  } catch (err) {
    next(err);
  }
}
