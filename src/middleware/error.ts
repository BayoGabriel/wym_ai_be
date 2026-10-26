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

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const isApi = err instanceof ApiError;
  const fallbackStatus =
    !isApi &&
    typeof err === 'object' &&
    err &&
    'status' in err &&
    typeof (err as any).status === 'number'
      ? (err as any).status
      : 500;
  const fallbackCode =
    !isApi &&
    typeof err === 'object' &&
    err &&
    'code' in err &&
    typeof (err as any).code === 'string'
      ? (err as any).code
      : 'INTERNAL_SERVER_ERROR';
  const fallbackMessage =
    !isApi &&
    typeof err === 'object' &&
    err &&
    'message' in err &&
    typeof (err as any).message === 'string'
      ? (err as any).message
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
