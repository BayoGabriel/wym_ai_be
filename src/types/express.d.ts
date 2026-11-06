import { AuthContext } from './auth';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the `authenticate` middleware. */
      auth: AuthContext;
      /** Raw request body buffer, captured by express.json's verify callback. */
      rawBody?: Buffer;
    }
  }
}

export {};
