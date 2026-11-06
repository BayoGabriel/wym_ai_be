import { NextFunction, Request, Response } from 'express';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, 'NOT_FOUND', 'Resource not found'));
}

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  // Express only treats this as an error handler when all four params exist.
  void next;
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const isErrObj = typeof err === 'object' && err !== null;
  const errCode =
    isErrObj && 'code' in err && typeof err.code === 'string' ? err.code : 'INTERNAL_SERVER_ERROR';

  // Postgres driver errors carry SQLSTATE codes — a malformed UUID in an :id
  // param (22P02) or a constraint violation would otherwise surface as a 500.
  if (errCode === '22P02' || errCode === '23502') {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid input' } });
    return;
  }
  if (errCode === '23503' || errCode === '23505') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Resource conflict' } });
    return;
  }

  const status =
    isErrObj && 'status' in err && typeof err.status === 'number' ? err.status : 500;
  const code =
    status === 413
      ? 'PAYLOAD_TOO_LARGE'
      : status >= 500
        ? 'INTERNAL_SERVER_ERROR'
        : errCode;
  const message =
    status >= 500
      ? 'An unexpected error occurred'
      : isErrObj && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'An unexpected error occurred';

  res.status(status).json({ error: { code, message } });
}
