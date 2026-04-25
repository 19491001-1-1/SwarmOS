import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  senderName: text('sender_name').notNull(),
  content: text('content').notNull(),
  agentId: text('agent_id'),
  createdAt: text('created_at').notNull(),
});

export const activities = sqliteTable('activities', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  type: text('type').notNull(),
  detail: text('detail'),
  createdAt: text('created_at').notNull(),
});

export const directMessages = sqliteTable('direct_messages', {
  id: text('id').primaryKey(),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export const agentDelegations = sqliteTable('agent_delegations', {
  id: text('id').primaryKey(),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  content: text('content').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

export const agentTokens = sqliteTable('agent_tokens', {
  agentId: text('agent_id').primaryKey(),
  token: text('token').notNull(),
  createdAt: text('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id'),
  title: text('title').notNull(),
  status: text('status').notNull(),
  creatorName: text('creator_name').notNull(),
  assigneeId: text('assignee_id'),
  context: text('context'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  displayName: text('display_name'),
  description: text('description'),
  runtime: text('runtime').notNull(),
  model: text('model'),
  systemPrompt: text('system_prompt'),
  envVars: text('env_vars'),
  machineId: text('machine_id'),
  status: text('status').notNull(),
  autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const machines = sqliteTable('machines', {
  id: text('id').primaryKey(),
  hostname: text('hostname').notNull(),
  os: text('os').notNull(),
  daemonVersion: text('daemon_version').notNull(),
  runtimes: text('runtimes').notNull(),
  runtimeVersions: text('runtime_versions').notNull(),
  status: text('status').notNull(),
  connectedAt: text('connected_at').notNull(),
});
