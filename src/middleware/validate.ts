import { NextFunction, Request, Response } from 'express';
import { ZodType, ZodTypeDef } from 'zod';

export function validate(
  schema: ZodType<unknown, ZodTypeDef, unknown>,
  pick: 'body' | 'params' | 'query' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[pick]);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: parsed.error.flatten(),
        },
      });
    }
    (req as unknown as Record<string, unknown>)[pick] = parsed.data;
    next();
  };
}
