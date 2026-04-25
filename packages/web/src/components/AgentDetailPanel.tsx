import { useEffect, useState } from 'react';
import type { Agent, AgentActivity, DirectMessage, DirectMessageThread, Reminder } from '../api.js';
import { cancelReminder, createAgentReminder, getAgentDirectMessages, getAgentDmThreads, patchAgent, sendAgentDirectMessage } from '../api.js';
import { WorkspaceBrowser } from './WorkspaceBrowser.js';

type Props = {
  agent: Agent;
  activities: AgentActivity[];
  reminders: Reminder[];
  onReminderUpdated: (reminder: Reminder) => void;
  onAgentUpdated: (agent: Agent) => void;
  onClose: () => void;
};

type Tab = 'profile' | 'dms' | 'reminders' | 'workspace' | 'activity';

const FONT = "'Courier New', monospace";

const ACTIVITY_META: Record<AgentActivity['type'], { label: string; color: string }> = {
  thinking: { label: 'THINKING', color: '#FFD700' },
  working: { label: 'WORKING', color: '#ff9800' },
  output: { label: 'OUTPUT', color: '#2196f3' },
  idle: { label: 'IDLE', color: '#9e9e9e' },
  sending: { label: 'SENDING MESSAGE', color: '#00c853' },
  error: { label: 'ERROR', color: '#f44336' },
};

export function AgentDetailPanel({ agent, activities, reminders, onReminderUpdated, onAgentUpdated, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('profile');

  return (
    <div style={{
      width: 360,
      background: '#fafaf5',
      borderLeft: '2px solid #000',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      fontFamily: FONT,
    }}>
      <div style={{
        height: 48,
        padding: '0 10px',
        borderBottom: '2px solid #000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#fff',
        flexShrink: 0,
        gap: 8,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.displayName ?? agent.name}
        </span>
        <button onClick={onClose} style={buttonStyle('#000', '#FFD700')}>X</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '2px solid #000', background: '#fff' }}>
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>PROFILE</TabButton>
        <TabButton active={tab === 'dms'} onClick={() => setTab('dms')}>DMS</TabButton>
        <TabButton active={tab === 'reminders'} onClick={() => setTab('reminders')}>REMIND</TabButton>
        <TabButton active={tab === 'workspace'} onClick={() => setTab('workspace')}>FILES</TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>LOG</TabButton>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        {tab === 'profile' ? <Profile agent={agent} onAgentUpdated={onAgentUpdated} /> : null}
        {tab === 'dms' ? <DirectMessages agent={agent} /> : null}
        {tab === 'reminders' ? <Reminders agent={agent} reminders={reminders} onReminderUpdated={onReminderUpdated} /> : null}
        {tab === 'workspace' ? <WorkspaceBrowser agentId={agent.id} /> : null}
        {tab === 'activity' ? <ActivityTimeline activities={activities} /> : null}
      </div>
    </div>
  );
}

function Profile({ agent, onAgentUpdated }: { agent: Agent; onAgentUpdated: (agent: Agent) => void }) {
  const [displayName, setDisplayName] = useState(agent.displayName ?? '');
  const [description, setDescription] = useState(agent.description ?? '');
  const [model, setModel] = useState(agent.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt ?? '');
  const [envVarsText, setEnvVarsText] = useState(formatEnvVars(agent.envVars));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setDisplayName(agent.displayName ?? '');
    setDescription(agent.description ?? '');
    setModel(agent.model ?? '');
    setSystemPrompt(agent.systemPrompt ?? '');
    setEnvVarsText(formatEnvVars(agent.envVars));
    setError(undefined);
  }, [agent.id, agent.displayName, agent.description, agent.model, agent.systemPrompt, agent.envVars]);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await patchAgent(agent.id, {
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
        model: model.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        envVars: parseEnvVars(envVarsText),
      });
      onAgentUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SAVE FAILED');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ border: '2px solid #000', background: '#fff', display: 'grid', gridTemplateColumns: '58px 1fr' }}>
        <div style={{ height: 58, background: '#FFD700', borderRight: '2px solid #000', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 20 }}>
          {(agent.displayName ?? agent.name).slice(0, 2).toUpperCase()}
        </div>
        <div style={{ padding: 8, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>{agent.name}</div>
          <div style={{ marginTop: 4, fontSize: 11, color: '#555' }}>{agent.runtime.toUpperCase()} / {agent.status.toUpperCase()}</div>
        </div>
      </div>
      <Field label="DISPLAY" value={displayName} onChange={setDisplayName} />
      <Field label="DESCRIPTION" value={description} onChange={setDescription} multiline />
      <Field label="MODEL" value={model} onChange={setModel} />
      <Field label="SYSTEM" value={systemPrompt} onChange={setSystemPrompt} multiline />
      <Field label="ENV" value={envVarsText} onChange={setEnvVarsText} multiline />
      <ReadonlyRows rows={[
        ['MACHINE', agent.machineId ?? '-'],
        ['CREATED', formatDate(agent.createdAt)],
      ]} />
      {error ? <div style={{ fontSize: 11, color: '#b00020', fontWeight: 700 }}>{error}</div> : null}
      <button onClick={save} disabled={saving} style={buttonStyle('#000', '#FFD700')}>
        {saving ? 'SAVING' : 'SAVE'}
      </button>
    </div>
  );
}

function DirectMessages({ agent }: { agent: Agent }) {
  const [threads, setThreads] = useState<DirectMessageThread[]>([]);
  const [selectedOtherId, setSelectedOtherId] = useState('user');
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState('');

  const loadThreads = async () => {
    const data = await getAgentDmThreads(agent.id);
    setThreads(data);
    if (selectedOtherId === 'user' && data.length > 0) setSelectedOtherId(data[0].otherAgentId);
  };

  const loadMessages = async (otherId: string) => {
    if (!otherId.trim()) {
      setMessages([]);
      return;
    }
    setMessages(await getAgentDirectMessages(agent.id, otherId.trim()));
  };

  useEffect(() => {
    setSelectedOtherId('user');
    setMessages([]);
    loadThreads();
  }, [agent.id]);

  useEffect(() => {
    loadMessages(selectedOtherId);
  }, [agent.id, selectedOtherId]);

  const send = async () => {
    const content = draft.trim();
    const otherId = selectedOtherId.trim() || 'user';
    if (!content) return;
    const sent = await sendAgentDirectMessage(agent.id, otherId, content);
    setDraft('');
    setSelectedOtherId(otherId);
    setMessages((prev) => [...prev, sent]);
    await loadThreads();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
        <input
          value={selectedOtherId}
          onChange={(event) => setSelectedOtherId(event.target.value)}
          style={inputStyle}
          placeholder="other id"
        />
        <button onClick={() => loadMessages(selectedOtherId)} style={buttonStyle('#fff', '#000')}>OPEN</button>
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        <button onClick={() => setSelectedOtherId('user')} style={threadButtonStyle(selectedOtherId === 'user')}>user</button>
        {threads.map((thread) => (
          <button key={thread.otherAgentId} onClick={() => setSelectedOtherId(thread.otherAgentId)} style={threadButtonStyle(selectedOtherId === thread.otherAgentId)}>
            {thread.otherAgentId}
          </button>
        ))}
      </div>
      <div style={{ border: '2px solid #000', background: '#fff', minHeight: 260, maxHeight: 360, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 ? <EmptyBox label="[ NO DIRECT MESSAGES ]" /> : null}
        {messages.map((message) => (
          <div key={message.id} style={{
            alignSelf: message.fromAgentId === agent.id ? 'flex-end' : 'flex-start',
            maxWidth: '88%',
            border: '2px solid #000',
            background: message.fromAgentId === agent.id ? '#FFD700' : '#fafaf5',
            padding: 8,
            fontSize: 11,
            overflowWrap: 'anywhere',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{message.fromAgentId}</div>
            <div>{message.content}</div>
            <div style={{ marginTop: 5, color: '#555', fontSize: 10 }}>{formatTime(message.createdAt)}</div>
          </div>
        ))}
      </div>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} style={{ ...inputStyle, minHeight: 74, resize: 'vertical' }} />
      <button onClick={send} style={buttonStyle('#000', '#FFD700')}>SEND DM</button>
    </div>
  );
}

function Reminders({ agent, reminders, onReminderUpdated }: { agent: Agent; reminders: Reminder[]; onReminderUpdated: (reminder: Reminder) => void }) {
  const [message, setMessage] = useState('');
  const [triggerAt, setTriggerAt] = useState('');
  const [channelId, setChannelId] = useState('general');
  const [error, setError] = useState<string | undefined>();

  const create = async () => {
    setError(undefined);
    if (!message.trim() || !triggerAt) return;
    try {
      const iso = new Date(triggerAt).toISOString();
      const reminder = await createAgentReminder(agent.id, { channelId: channelId.trim() || 'general', message: message.trim(), triggerAt: iso });
      setMessage('');
      setTriggerAt('');
      onReminderUpdated(reminder);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CREATE FAILED');
    }
  };

  const cancel = async (id: string) => {
    const updated = await cancelReminder(id);
    onReminderUpdated(updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ border: '2px dashed #000', background: '#fff', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 18 }}>BEL</div>
        <input value={message} onChange={(event) => setMessage(event.target.value)} style={inputStyle} placeholder="message" />
        <input value={triggerAt} onChange={(event) => setTriggerAt(event.target.value)} style={inputStyle} type="datetime-local" />
        <input value={channelId} onChange={(event) => setChannelId(event.target.value)} style={inputStyle} placeholder="channel" />
        {error ? <div style={{ fontSize: 11, color: '#b00020', fontWeight: 700 }}>{error}</div> : null}
        <button onClick={create} style={buttonStyle('#000', '#FFD700')}>ADD REMINDER</button>
      </div>
      {reminders.length === 0 ? <EmptyBox label="[ NO PENDING REMINDERS ]" /> : null}
      {reminders.map((reminder) => (
        <div key={reminder.id} style={{ border: '2px solid #000', background: '#fff', padding: 8, display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{formatDate(reminder.triggerAt)}</span>
            <span style={{ border: '2px solid #000', background: reminder.status === 'pending' ? '#FFD700' : '#fafaf5', padding: '2px 5px', fontSize: 10, fontWeight: 700 }}>
              {reminder.status.toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{reminder.message}</div>
          <div style={{ fontSize: 10, color: '#555' }}>#{reminder.channelId}</div>
          {reminder.status === 'pending' ? <button onClick={() => cancel(reminder.id)} style={buttonStyle('#fff', '#000')}>CANCEL</button> : null}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, fontWeight: 700 }}>
      {label}
      {multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} style={{ ...inputStyle, minHeight: 78, resize: 'vertical' }} />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} />
      )}
    </label>
  );
}

function ReadonlyRows({ rows }: { rows: string[][] }) {
  return (
    <div style={{ border: '2px solid #000', background: '#fff' }}>
      {rows.map(([label, value], index) => (
        <div key={label} style={{ display: 'grid', gridTemplateColumns: '82px 1fr', borderBottom: index === rows.length - 1 ? 'none' : '2px solid #000' }}>
          <div style={{ padding: '8px', fontSize: 10, fontWeight: 700, background: '#FFD700', borderRight: '2px solid #000' }}>{label}</div>
          <div style={{ padding: '8px', fontSize: 11, overflowWrap: 'anywhere' }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function ActivityTimeline({ activities }: { activities: AgentActivity[] }) {
  if (activities.length === 0) return <EmptyBox label="[ NO ACTIVITY ]" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {activities.map((activity) => {
        const meta = ACTIVITY_META[activity.type];
        return (
          <div key={activity.id} style={{
            display: 'grid',
            gridTemplateColumns: '62px 12px 1fr',
            gap: 7,
            alignItems: 'start',
            border: '2px solid #000',
            background: '#fff',
            padding: '7px 8px',
            fontSize: 11,
          }}>
            <span style={{ color: '#555' }}>{formatTime(activity.createdAt)}</span>
            <span style={{ width: 10, height: 10, background: meta.color, border: '1.5px solid #000', marginTop: 1 }} />
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <strong>{meta.label}</strong>
              {activity.detail ? <span style={{ color: '#555' }}> {activity.detail}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyBox({ label }: { label: string }) {
  return (
    <div style={{ border: '2px dashed #bbb', padding: 16, textAlign: 'center', fontSize: 11, color: '#777' }}>
      {label}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      minWidth: 0,
      padding: '9px 4px',
      border: 'none',
      borderRight: '2px solid #000',
      background: active ? '#FFD700' : '#fff',
      color: '#000',
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 10,
      cursor: 'pointer',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}>
      {children}
    </button>
  );
}

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 11,
    border: '2px solid #000',
    background,
    color,
    cursor: 'pointer',
    padding: '6px 9px',
    flexShrink: 0,
  };
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '2px solid #000',
  background: '#fff',
  color: '#000',
  fontFamily: FONT,
  fontSize: 11,
  padding: 8,
};

function threadButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...buttonStyle(active ? '#FFD700' : '#fff', '#000'),
    whiteSpace: 'nowrap',
    padding: '5px 8px',
  };
}

function parseEnvVars(value: string): Record<string, string> | undefined {
  const pairs = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      if (index === -1) return [line, ''];
      return [line.slice(0, index).trim(), line.slice(index + 1)];
    })
    .filter(([key]) => key);
  if (pairs.length === 0) return undefined;
  return Object.fromEntries(pairs);
}

function formatEnvVars(envVars: Record<string, string> | undefined): string {
  if (!envVars) return '';
  return Object.entries(envVars).map(([key, value]) => `${key}=${value}`).join('\n');
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
