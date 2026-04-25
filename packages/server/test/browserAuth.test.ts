import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('browser auth', () => {
  it('allows anonymous local API access when WEB_AUTH_TOKEN is not configured', async () => {
    vi.stubEnv('WEB_AUTH_TOKEN', '');
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/auth/whoami' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ authenticated: true, mode: 'anonymous' });
    await app.close();
  });

  it('protects local API access when WEB_AUTH_TOKEN is configured', async () => {
    vi.stubEnv('WEB_AUTH_TOKEN', 'local-secret');
    const app = await buildApp();

    const rejected = await app.inject({ method: 'GET', url: '/api/channels' });
    expect(rejected.statusCode).toBe(401);

    const accepted = await app.inject({
      method: 'GET',
      url: '/api/auth/whoami',
      headers: { Authorization: 'Bearer local-secret' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ authenticated: true, mode: 'token' });

    await app.close();
  });

  it('protects local browser websocket when WEB_AUTH_TOKEN is configured', async () => {
    vi.stubEnv('WEB_AUTH_TOKEN', 'local-secret');
    const app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 3000;

    const rejected = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('open', () => {
        ws.close();
        resolve(101);
      });
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => resolve(401));
    });
    expect(rejected).not.toBe(101);

    const accepted = await new Promise<boolean>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=local-secret`);
      ws.on('open', () => {
        ws.close();
        resolve(true);
      });
      ws.on('error', reject);
    });
    expect(accepted).toBe(true);

    await app.close();
  });
});
