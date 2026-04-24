import type { Channel, Message, Machine, Agent, RuntimeId, AgentStatus } from '@mini-slock/shared';

export class InMemoryStore {
  private channels = new Map<string, Channel>();
  private messages = new Map<string, Message>();
  private machines = new Map<string, Machine>();
  private agents = new Map<string, Agent>();

  constructor() {
    const now = new Date().toISOString();
    this.channels.set('general', {
      id: 'general',
      name: 'general',
      createdAt: now,
    });
  }

  // Channels
  listChannels(): Channel[] {
    return Array.from(this.channels.values());
  }

  getChannel(id: string): Channel | undefined {
    return this.channels.get(id);
  }

  createChannel(id: string, name: string): Channel {
    const channel: Channel = { id, name, createdAt: new Date().toISOString() };
    this.channels.set(id, channel);
    return channel;
  }

  // Messages
  listMessages(channelId: string): Message[] {
    return Array.from(this.messages.values())
      .filter((m) => m.channelId === channelId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  createMessage(msg: Omit<Message, 'createdAt'>): Message {
    const message: Message = { ...msg, createdAt: new Date().toISOString() };
    this.messages.set(message.id, message);
    return message;
  }

  getMessage(id: string): Message | undefined {
    return this.messages.get(id);
  }

  // Machines
  listMachines(): Machine[] {
    return Array.from(this.machines.values());
  }

  getMachine(id: string): Machine | undefined {
    return this.machines.get(id);
  }

  upsertMachine(machine: Machine): Machine {
    this.machines.set(machine.id, machine);
    return machine;
  }

  setMachineOffline(id: string): void {
    const m = this.machines.get(id);
    if (m) {
      this.machines.set(id, { ...m, status: 'offline' });
    }
  }

  // Agents
  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  createAgent(agent: Agent): Agent {
    this.agents.set(agent.id, agent);
    return agent;
  }

  updateAgentStatus(id: string, status: AgentStatus): Agent | undefined {
    const agent = this.agents.get(id);
    if (!agent) return undefined;
    const updated = { ...agent, status };
    this.agents.set(id, updated);
    return updated;
  }

  updateAgent(id: string, patch: Partial<Agent>): Agent | undefined {
    const agent = this.agents.get(id);
    if (!agent) return undefined;
    const updated = { ...agent, ...patch };
    this.agents.set(id, updated);
    return updated;
  }
}

let _store: InMemoryStore | null = null;

export function getStore(): InMemoryStore {
  if (!_store) _store = new InMemoryStore();
  return _store;
}

export function resetStore(): void {
  _store = new InMemoryStore();
}
