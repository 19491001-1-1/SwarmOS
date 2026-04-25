import type { FastifyReply, FastifyRequest } from 'fastify';

export function browserAuthConfigured(): boolean {
  return !!process.env.WEB_AUTH_TOKEN?.trim();
}

export function validateBrowserToken(token: string | undefined): boolean {
  const expected = process.env.WEB_AUTH_TOKEN?.trim();
  if (!expected) return true;
  if (!token?.trim()) return false;
  return timingSafeEqualStr(token.trim(), expected);
}

export async function requireBrowserAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!browserAuthConfigured()) return;
  const token = bearerToken(request.headers.authorization);
  if (!validateBrowserToken(token)) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = (header ?? '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
