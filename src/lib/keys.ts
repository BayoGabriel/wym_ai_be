import { randomBytes } from 'crypto';

// Public, rotatable identifier for the embeddable widget. ~122 bits of entropy —
// unguessable, so a leaked snippet can be revoked without renaming the org.
export function newPublicKey() {
  return `pk_${randomBytes(16).toString('base64url')}`;
}
