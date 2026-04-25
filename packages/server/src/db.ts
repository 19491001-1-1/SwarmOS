import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { Channel, Message, Machine, Agent, RuntimeId, AgentStatus, AgentActivity } from '@mini-slock/shared';
import { activities, agents, channels, machines, messages } from './schema.js';

type Database = LibSQLDatabase<typeof import('./schema.js')>;

let client: Client | null = null;
let db: Database | null = null;
let store: SqliteStore | null = null;
let initialized = false;
let initialization: Promise<void> | null = null;

function getDbPath(): string {
  return process.env.XOXIANG_DB_PATH || join(homedir(), '.xoxiang', 'data.db');
}

function getDbUrl(path: string): string {
  if (path === ':memory:') return 'file::memory:';
  return `file:${path}`;
}

async function ensureDbDirectory(path: string): Promise<void> {
  if (path === ':memory:') return;
  await mkdir(dirname(path), { recursive: true });
}

function createDatabase(): Database {
  const path = getDbPath();
  client = createClient({ url: getDbUrl(path) });
  db = drizzle(client, { schema: { activities, agents, channels, machines, messages } });
  return db;
}

export function getDb(): Database {
  return db ?? createDatabase();
}

export async function initDb(): Promise<void> {
  if (initialized) return;
  if (initialization) return initialization;

  initialization = (async () => {
    const path = getDbPath();
    await ensureDbDirectory(path);
    const database = getDb();

    await database.run(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        runtime TEXT NOT NULL,
        model TEXT,
        system_prompt TEXT,
        machine_id TEXT,
        status TEXT NOT NULL,
        auto_start INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    try {
      await database.run('ALTER TABLE agents ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0');
    } catch (err) {
      const message = [String(err), (err as { message?: string }).message, (err as { cause?: { message?: string } }).cause?.message]
        .join(' ')
        .toLowerCase();
      if (!message.includes('duplicate column')) throw err;
    }
    await database.run(`
      CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL,
        os TEXT NOT NULL,
        daemon_version TEXT NOT NULL,
        runtimes TEXT NOT NULL,
        runtime_versions TEXT NOT NULL,
        status TEXT NOT NULL,
        connected_at TEXT NOT NULL
      )
    `);

    await database
      .insert(channels)
      .values({ id: 'general', name: 'general', createdAt: new Date().toISOString() })
      .onConflictDoNothing();
    await resetVolatileState();

    initialized = true;
  })();

  try {
    await initialization;
  } finally {
    initialization = null;
  }
}

export async function resetVolatileState(): Promise<void> {
  const database = getDb();
  await database.update(machines).set({ status: 'offline' });
}

function toAgent(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName ?? undefined,
    description: row.description ?? undefined,
    runtime: row.runtime as RuntimeId,
    model: row.model ?? undefined,
    systemPrompt: row.systemPrompt ?? undefined,
    machineId: row.machineId ?? undefined,
    status: row.status as AgentStatus,
    autoStart: row.autoStart,
    createdAt: row.createdAt,
  };
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    channelId: row.channelId,
    senderName: row.senderName,
    content: row.content,
    agentId: row.agentId ?? undefined,
    createdAt: row.createdAt,
  };
}

function toActivity(row: typeof activities.$inferSelect): AgentActivity {
  return {
    id: row.id,
    agentId: row.agentId,
    type: row.type as AgentActivity['type'],
    detail: row.detail ?? undefined,
    createdAt: row.createdAt,
  };
}

function toMachine(row: typeof machines.$inferSelect): Machine {
  return {
    id: row.id,
    hostname: row.hostname,
    os: row.os,
    daemonVersion: row.daemonVersion,
    runtimes: JSON.parse(row.runtimes) as RuntimeId[],
    runtimeVersions: JSON.parse(row.runtimeVersions) as Record<string, string>,
    status: row.status as Machine['status'],
    connectedAt: row.connectedAt,
  };
}

export class SqliteStore {
  async listChannels(): Promise<Channel[]> {
    await initDb();
    return getDb().select().from(channels).orderBy(asc(channels.createdAt));
  }

  async getChannel(id: string): Promise<Channel | undefined> {
    await initDb();
    const [channel] = await getDb().select().from(channels).where(eq(channels.id, id)).limit(1);
    return channel;
  }

  async createChannel(id: string, name: string): Promise<Channel> {
    await initDb();
    const channel: Channel = { id, name, createdAt: new Date().toISOString() };
    await getDb().insert(channels).values(channel);
    return channel;
  }

  async listMessages(channelId: string): Promise<Message[]> {
    await initDb();
    const rows = await getDb().select().from(messages).where(eq(messages.channelId, channelId)).orderBy(asc(messages.createdAt));
    return rows.map(toMessage);
  }

  async createMessage(msg: Omit<Message, 'createdAt'>): Promise<Message> {
    await initDb();
    const message: Message = { ...msg, createdAt: new Date().toISOString() };
    await getDb().insert(messages).values({
      ...message,
      agentId: message.agentId ?? null,
    });
    return message;
  }

  async addMessage(msg: Omit<Message, 'createdAt'>): Promise<Message> {
    return this.createMessage(msg);
  }

  async createAgentActivity(activity: Omit<AgentActivity, 'createdAt'>): Promise<AgentActivity> {
    await initDb();
    const created: AgentActivity = { ...activity, createdAt: new Date().toISOString() };
    await getDb().insert(activities).values({
      ...created,
      detail: created.detail ?? null,
    });
    await this.truncateAgentActivities(created.agentId, 500);
    return created;
  }

  async listAgentActivities(agentId: string, limit = 200): Promise<AgentActivity[]> {
    await initDb();
    const rows = await getDb()
      .select()
      .from(activities)
      .where(eq(activities.agentId, agentId))
      .orderBy(desc(activities.createdAt))
      .limit(limit);
    return rows.map(toActivity);
  }

  private async truncateAgentActivities(agentId: string, keep: number): Promise<void> {
    const stale = await getDb()
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.agentId, agentId))
      .orderBy(desc(activities.createdAt))
      .limit(100000)
      .offset(keep);
    if (stale.length > 0) {
      await getDb().delete(activities).where(inArray(activities.id, stale.map((row) => row.id)));
    }
  }

  async getMessage(id: string): Promise<Message | undefined> {
    await initDb();
    const [message] = await getDb().select().from(messages).where(eq(messages.id, id)).limit(1);
    return message ? toMessage(message) : undefined;
  }

  async listMachines(): Promise<Machine[]> {
    await initDb();
    const rows = await getDb().select().from(machines).orderBy(asc(machines.connectedAt));
    return rows.map(toMachine);
  }

  async getMachine(id: string): Promise<Machine | undefined> {
    await initDb();
    const [machine] = await getDb().select().from(machines).where(eq(machines.id, id)).limit(1);
    return machine ? toMachine(machine) : undefined;
  }

  async upsertMachine(machine: Machine): Promise<Machine> {
    await initDb();
    await getDb()
      .insert(machines)
      .values({
        ...machine,
        runtimes: JSON.stringify(machine.runtimes),
        runtimeVersions: JSON.stringify(machine.runtimeVersions),
      })
      .onConflictDoUpdate({
        target: machines.id,
        set: {
          hostname: machine.hostname,
          os: machine.os,
          daemonVersion: machine.daemonVersion,
          runtimes: JSON.stringify(machine.runtimes),
          runtimeVersions: JSON.stringify(machine.runtimeVersions),
          status: machine.status,
          connectedAt: machine.connectedAt,
        },
      });
    return machine;
  }

  async mergeMachines(targetMachineId: string, duplicateMachineIds: string[]): Promise<void> {
    await initDb();
    const duplicates = duplicateMachineIds.filter((id) => id !== targetMachineId);
    if (duplicates.length === 0) return;

    await getDb().update(agents).set({ machineId: targetMachineId }).where(inArray(agents.machineId, duplicates));
    await getDb().delete(machines).where(inArray(machines.id, duplicates));
  }

  async setMachineOffline(id: string): Promise<void> {
    await initDb();
    await getDb().update(machines).set({ status: 'offline' }).where(eq(machines.id, id));
  }

  async listAgents(): Promise<Agent[]> {
    await initDb();
    const rows = await getDb().select().from(agents).orderBy(asc(agents.createdAt));
    return rows.map(toAgent);
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    await initDb();
    const [agent] = await getDb().select().from(agents).where(eq(agents.id, id)).limit(1);
    return agent ? toAgent(agent) : undefined;
  }

  async createAgent(agent: Agent): Promise<Agent> {
    await initDb();
    await getDb().insert(agents).values({
      ...agent,
      displayName: agent.displayName ?? null,
      description: agent.description ?? null,
      model: agent.model ?? null,
      systemPrompt: agent.systemPrompt ?? null,
      machineId: agent.machineId ?? null,
      autoStart: agent.autoStart ?? false,
    });
    return agent;
  }

  async updateAgentStatus(id: string, status: AgentStatus): Promise<Agent | undefined> {
    return this.updateAgent(id, { status });
  }

  async updateAgent(id: string, patch: Partial<Agent>): Promise<Agent | undefined> {
    await initDb();
    const existing = await this.getAgent(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    await getDb()
      .update(agents)
      .set({
        name: updated.name,
        displayName: updated.displayName ?? null,
        description: updated.description ?? null,
        runtime: updated.runtime,
        model: updated.model ?? null,
        systemPrompt: updated.systemPrompt ?? null,
        machineId: updated.machineId ?? null,
        status: updated.status,
        autoStart: updated.autoStart ?? false,
        createdAt: updated.createdAt,
      })
      .where(eq(agents.id, id));
    return updated;
  }
}

export function getStore(): SqliteStore {
  if (!store) store = new SqliteStore();
  return store;
}

export async function resetStore(): Promise<void> {
  await initDb();
  const database = getDb();
  await database.delete(messages);
  await database.delete(activities);
  await database.delete(agents);
  await database.delete(machines);
  await database.delete(channels);
  await database.insert(channels).values({ id: 'general', name: 'general', createdAt: new Date().toISOString() });
}
