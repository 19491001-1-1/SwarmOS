import { useState } from 'react';
import type { Agent, AgentActivity } from '../api.js';

type Props = {
  agent: Agent;
  activities: AgentActivity[];
  onClose: () => void;
};

const FONT = "'Courier New', monospace";

const ACTIVITY_META: Record<AgentActivity['type'], { label: string; color: string }> = {
  thinking: { label: 'THINKING', color: '#FFD700' },
  working: { label: 'WORKING', color: '#ff9800' },
  output: { label: 'OUTPUT', color: '#2196f3' },
  idle: { label: 'IDLE', color: '#9e9e9e' },
  sending: { label: 'SENDING MESSAGE', color: '#00c853' },
  error: { label: 'ERROR', color: '#f44336' },
};

export function AgentDetailPanel({ agent, activities, onClose }: Props) {
  const [tab, setTab] = useState<'profile' | 'activity'>('profile');

  return (
    <div style={{
      width: 320,
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

      <div style={{ display: 'flex', borderBottom: '2px solid #000', background: '#fff' }}>
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>PROFILE</TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>ACTIVITY</TabButton>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        {tab === 'profile' ? <Profile agent={agent} /> : <ActivityTimeline activities={activities} />}
      </div>
    </div>
  );
}

function Profile({ agent }: { agent: Agent }) {
  const rows = [
    ['NAME', agent.name],
    ['DISPLAY', agent.displayName ?? '-'],
    ['RUNTIME', agent.runtime.toUpperCase()],
    ['MODEL', agent.model ?? '-'],
    ['STATUS', agent.status.toUpperCase()],
    ['MACHINE', agent.machineId ?? '-'],
    ['CREATED', formatDate(agent.createdAt)],
  ];

  return (
    <div style={{ border: '2px solid #000', background: '#fff' }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'grid', gridTemplateColumns: '82px 1fr', borderBottom: label === 'CREATED' ? 'none' : '2px solid #000' }}>
          <div style={{ padding: '8px', fontSize: 10, fontWeight: 700, background: '#FFD700', borderRight: '2px solid #000' }}>{label}</div>
          <div style={{ padding: '8px', fontSize: 11, overflowWrap: 'anywhere' }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function ActivityTimeline({ activities }: { activities: AgentActivity[] }) {
  if (activities.length === 0) {
    return (
      <div style={{ border: '2px dashed #bbb', padding: 16, textAlign: 'center', fontSize: 11, color: '#777' }}>
        [ NO ACTIVITY ]
      </div>
    );
  }

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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      flex: 1,
      padding: '9px 6px',
      border: 'none',
      borderRight: '2px solid #000',
      background: active ? '#FFD700' : '#fff',
      color: '#000',
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 11,
      cursor: 'pointer',
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
    padding: '3px 8px',
    flexShrink: 0,
  };
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
