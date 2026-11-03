import { AuthContext } from './auth';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the `authenticate` middleware. */
      auth: AuthContext;
    }
  }
}

export {};
