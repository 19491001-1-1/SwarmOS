# Mock Server / Daemon

This folder contains two simple mock tools to help parallel development and integration testing:

- `tools/mock-server`: a Fastify server exposing `POST /api/v1/swarm/init` and `POST /api/v1/events`, plus a websocket endpoint at `/ws` to stream events to clients.
- `tools/mock-daemon`: a small script that posts a lifecycle sequence (`waiting_lock` -> `awaiting_approval` -> `running` -> `success`) to the mock server.

Quick start (from `proj/crewden`):

1. Start mock server

```bash
cd proj/crewden/tools/mock-server
pnpm install # or npm install
node index.js
```

2. Start mock daemon

```bash
cd proj/crewden/tools/mock-daemon
pnpm install # or npm install
MOCK_SERVER_URL=http://localhost:4001 node index.js
```

Websocket clients can connect to `ws://localhost:4001/ws` to receive events.

End-to-end automated run

From `proj/crewden`, run the e2e runner which will start/connect the mock server, trigger `swarm/init` (to a running crewden server if available; otherwise it posts to the mock server), start the mock daemon, and validate the event sequence:

```bash
cd proj/crewden/tools/mock
node e2e-runner.js
```

The runner exits with code `0` on success (observes the sequence `swarm:init -> waiting_lock -> awaiting_approval -> running -> success`) or non-zero on failure.
