import { nanoid } from 'nanoid';
import { getDb } from './db.js';

type SwarmSession = {
  id: string;
  channelId: string;
  agents: Array<{ agent_id: string }>;
  createdAt: string;
};

const store = new Map<string, SwarmSession>();

export function createSwarm(channelId: string, agents: Array<{ agent_id: string }>): SwarmSession {
  const id = 'sw_' + nanoid();
  const session: SwarmSession = { id, channelId, agents, createdAt: new Date().toISOString() };
  store.set(id, session);

  // try persist to DB, but don't fail if DB not available
  try {
    const db = getDb();
    // Inline values into SQL to avoid API mismatch with the database wrapper used in tests.
    const safeAgents = JSON.stringify(agents).replace(/'/g, "''");
    const sql = `INSERT INTO swarms (id, channel_id, agents_json, created_at) VALUES ('${id}', '${channelId}', '${safeAgents}', '${session.createdAt}')`;
    db.run(sql).catch(() => undefined);
  } catch (e) {
    // ignore persistence errors; in-memory still works
  }

  return session;
}

export function getSwarm(id: string) {
  return store.get(id);
}

export function listSwarms() {
  return Array.from(store.values());
}

export function clearSwarmStore() {
  store.clear();
}
