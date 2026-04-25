import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        miniflare: {
          bindings: {
            DAEMON_API_KEY: 'test-daemon-key',
            WEB_AUTH_TOKEN: 'test-web-token',
          },
        },
        wrangler: {
          configPath: './wrangler.jsonc',
        },
      },
    },
  },
});
