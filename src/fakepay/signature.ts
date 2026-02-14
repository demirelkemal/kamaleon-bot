import { createHmac, timingSafeEqual } from 'node:crypto';

export function signFakepayPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyFakepaySignature(rawBody: string, secret: string, signature: string | undefined): boolean {
  if (!signature) {
    return false;
  }

  const expected = signFakepayPayload(rawBody, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
