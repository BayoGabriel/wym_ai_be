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
  const isApi = err instanceof ApiError;
  const isErrObj = typeof err === 'object' && err !== null;
  const fallbackStatus =
    !isApi && isErrObj && 'status' in err && typeof err.status === 'number' ? err.status : 500;
  const fallbackCode =
    !isApi && isErrObj && 'code' in err && typeof err.code === 'string'
      ? err.code
      : 'INTERNAL_SERVER_ERROR';
  const fallbackMessage =
    !isApi && isErrObj && 'message' in err && typeof err.message === 'string'
      ? err.message
      : 'An unexpected error occurred';

  const status = isApi ? err.status : fallbackStatus;
  const code = isApi ? err.code : status >= 500 ? 'INTERNAL_SERVER_ERROR' : fallbackCode;
  const message = isApi
    ? err.message
    : status >= 500
      ? 'An unexpected error occurred'
      : fallbackMessage;

  res.status(status).json({ error: { code, message } });
}
