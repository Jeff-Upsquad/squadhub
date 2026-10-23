/** An error a bridge endpoint turns into `{ success:false, error }` with `status`. */
export class BridgeError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
