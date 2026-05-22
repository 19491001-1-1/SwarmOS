const Fastify = require('fastify');
const websocket = require('fastify-websocket');
const { randomUUID } = require('crypto');

const fastify = Fastify({ logger: true });
fastify.register(websocket);

const clients = new Set();

fastify.post('/api/v1/swarm/init', async (req, reply) => {
  const body = req.body || {};
  const swarmId = 'sw_' + randomUUID().slice(0,8);
  const res = {
    protocol_version: body.protocol_version || 'v1.0.0',
    swarm_id: swarmId,
    channel_id: body.channel_id || 'c_mock',
    agent_count: Array.isArray(body.agents) ? body.agents.length : 0,
    status: 'initialized'
  };
  reply.code(201).send(res);
});

fastify.post('/api/v1/events', async (req, reply) => {
  const ev = req.body;
  // broadcast to websocket clients
  const msg = JSON.stringify(ev);
  for (const s of clients) {
    try { s.send(msg); } catch (e) { }
  }
  reply.send({ ok: true });
});

fastify.get('/ws', { websocket: true }, (connection /* SocketStream */, req /* FastifyRequest */) => {
  clients.add(connection.socket);
  connection.socket.on('close', () => clients.delete(connection.socket));
});

const start = async () => {
  try {
    await fastify.listen({ port: 4001, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
