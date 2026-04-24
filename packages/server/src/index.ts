import { buildApp } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);

const app = await buildApp({ logger: true });

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server listening on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
