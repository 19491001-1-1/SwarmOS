import { useMemo, useState } from 'react';
import type React from 'react';
import type { Agent, Channel, Task, TaskStatus } from '../api.js';
import { createTask, deleteTask, patchTask } from '../api.js';

type Props = {
  tasks: Task[];
  channels: Channel[];
  agents: Agent[];
  onTaskUpdated: (task: Task) => void;
  onTaskDeleted: (taskId: string) => void;
};

const STATUSES: Array<{ id: TaskStatus; label: string }> = [
  { id: 'todo', label: 'TODO' },
  { id: 'in_progress', label: 'DOING' },
  { id: 'in_review', label: 'REVIEW' },
  { id: 'done', label: 'DONE' },
];

const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: '#fff',
  in_progress: '#FFD700',
  in_review: '#7dd3fc',
  done: '#86efac',
};

export function TaskBoard({ tasks, channels, agents, onTaskUpdated, onTaskDeleted }: Props) {
  const [view, setView] = useState<'board' | 'list'>('board');
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !channelId || task.channelId === channelId),
    [tasks, channelId],
  );

  async function handleCreate() {
    const trimmed = title.trim();
    if (!trimmed) return;
    const task = await createTask({
      title: trimmed,
      channelId: channelId || 'general',
      assigneeId: assigneeId || undefined,
      creatorName: 'user',
    });
    onTaskUpdated(task);
    setTitle('');
  }

  async function handleStatus(task: Task, status: TaskStatus) {
    if (task.status === status) return;
    onTaskUpdated(await patchTask(task.id, { status }));
  }

  async function handleDelete(task: Task) {
    await deleteTask(task.id);
    onTaskDeleted(task.id);
  }

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#fafaf5',
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{
        minHeight: 58,
        padding: '10px 16px',
        borderBottom: '2px solid #000',
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}>
        <strong style={{ fontSize: 15, marginRight: 8 }}>TASKS</strong>
        <Segmented value={view} onChange={setView} />
        <select value={channelId} onChange={(event) => setChannelId(event.target.value)} style={selectStyle}>
          <option value="">all channels</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
        </select>
        <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} style={selectStyle}>
          <option value="">unassigned</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName ?? agent.name}</option>)}
        </select>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') handleCreate(); }}
          placeholder="New task"
          style={{
            minWidth: 180,
            flex: '1 1 260px',
            height: 32,
            border: '2px solid #000',
            padding: '0 10px',
            fontFamily: "'Courier New', monospace",
            fontSize: 13,
          }}
        />
        <button onClick={handleCreate} style={buttonStyle('#FF4D8D', '#fff')}>ADD</button>
      </div>

      {view === 'board' ? (
        <div style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
          gap: 12,
          padding: 16,
        }}>
          {STATUSES.map((status) => (
            <section key={status.id} style={{ minWidth: 220 }}>
              <ColumnHeader label={status.label} count={visibleTasks.filter((task) => task.status === status.id).length} color={STATUS_COLORS[status.id]} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {visibleTasks.filter((task) => task.status === status.id).map((task) => (
                  <TaskCard key={task.id} task={task} agents={agents} channels={channels} onStatus={handleStatus} onDelete={handleDelete} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {visibleTasks.map((task) => (
            <TaskCard key={task.id} task={task} agents={agents} channels={channels} onStatus={handleStatus} onDelete={handleDelete} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, agents, channels, onStatus, onDelete, compact = false }: {
  task: Task;
  agents: Agent[];
  channels: Channel[];
  onStatus: (task: Task, status: TaskStatus) => void;
  onDelete: (task: Task) => void;
  compact?: boolean;
}) {
  const assignee = agents.find((agent) => agent.id === task.assigneeId);
  const channel = channels.find((candidate) => candidate.id === task.channelId);
  return (
    <article style={{
      border: '2px solid #000',
      background: '#fff',
      padding: 10,
      marginBottom: compact ? 8 : 0,
      boxShadow: '3px 3px 0 #000',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <strong style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.4, wordBreak: 'break-word' }}>{task.title}</strong>
        <button title="Delete task" onClick={() => onDelete(task)} style={iconButtonStyle}>x</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', fontSize: 11 }}>
        <span>#{channel?.name ?? task.channelId}</span>
        <span>{assignee ? `@${assignee.displayName ?? assignee.name}` : '@unassigned'}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 10 }}>
        {STATUSES.map((status) => (
          <button
            key={status.id}
            title={status.label}
            onClick={() => onStatus(task, status.id)}
            style={{
              height: 24,
              border: '1.5px solid #000',
              background: task.status === status.id ? STATUS_COLORS[status.id] : '#fff',
              fontFamily: "'Courier New', monospace",
              fontSize: 9,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {status.label.slice(0, 2)}
          </button>
        ))}
      </div>
    </article>
  );
}

function ColumnHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '2px solid #000', background: color, padding: '7px 9px', marginBottom: 10 }}>
      <strong style={{ fontSize: 12 }}>{label}</strong>
      <span style={{ fontSize: 11, fontWeight: 700 }}>{count}</span>
    </div>
  );
}

function Segmented({ value, onChange }: { value: 'board' | 'list'; onChange: (value: 'board' | 'list') => void }) {
  return (
    <div style={{ display: 'flex', border: '2px solid #000', height: 32 }}>
      {(['board', 'list'] as const).map((item) => (
        <button key={item} onClick={() => onChange(item)} style={{
          width: 58,
          border: 'none',
          borderRight: item === 'board' ? '2px solid #000' : 'none',
          background: value === item ? '#000' : '#fff',
          color: value === item ? '#FFD700' : '#000',
          fontFamily: "'Courier New', monospace",
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
        }}>{item.toUpperCase()}</button>
      ))}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  height: 32,
  border: '2px solid #000',
  background: '#fff',
  fontFamily: "'Courier New', monospace",
  fontSize: 12,
};

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    height: 32,
    border: '2px solid #000',
    background,
    color,
    padding: '0 12px',
    fontFamily: "'Courier New', monospace",
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  };
}

const iconButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  border: '1.5px solid #000',
  background: '#fff',
  fontFamily: "'Courier New', monospace",
  fontWeight: 700,
  cursor: 'pointer',
  flexShrink: 0,
};
