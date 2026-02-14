import { timingSafeEqual } from 'node:crypto';

export function verifyBearerToken(headerValue: string | undefined, expectedToken: string): boolean {
  if (!headerValue) return false;

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return false;

  const provided = Buffer.from(token);
  const expected = Buffer.from(expectedToken);

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
