import type { Channel, Agent, Machine } from '../api.js';

type Props = {
  channels: Channel[];
  agents: Agent[];
  machines: Machine[];
  selectedChannel: string;
  onSelectChannel: (id: string) => void;
};

const S = {
  sidebar: {
    width: 240,
    background: '#FFD700',
    borderRight: '2px solid #000',
    display: 'flex',
    flexDirection: 'column' as const,
    flexShrink: 0,
    overflowY: 'auto' as const,
    fontFamily: "'Courier New', monospace",
  },
  workspaceName: {
    padding: '14px 14px 12px',
    fontWeight: 700,
    fontSize: 16,
    borderBottom: '2px solid #000',
    letterSpacing: '-0.3px',
    background: '#FFD700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeader: {
    padding: '12px 14px 4px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.8px',
    textTransform: 'uppercase' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
};

export function Sidebar({ channels, agents, machines, selectedChannel, onSelectChannel }: Props) {
  return (
    <div style={S.sidebar}>
      <div style={S.workspaceName}>
        <span>▶ WORKSPACE</span>
        <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.6 }}>v0.1</span>
      </div>

      <div style={{ padding: '4px 0' }}>
        <SectionHeader label="CHANNELS" count={channels.length} />
        {channels.map((ch) => (
          <ChannelItem
            key={ch.id}
            name={ch.name}
            active={selectedChannel === ch.id}
            onClick={() => onSelectChannel(ch.id)}
          />
        ))}

        <SectionHeader label="AGENTS" count={agents.length} style={{ marginTop: 8 }} />
        {agents.length === 0 && <EmptyHint text="no agents" />}
        {agents.map((a) => (
          <div key={a.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '4px 14px',
            fontSize: 12,
          }}>
            <StatusDot status={a.status} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
              {a.displayName ?? a.name}
            </span>
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              border: '1.5px solid #000',
              padding: '0 4px',
              background: '#fff',
              letterSpacing: '0.5px',
            }}>
              {a.runtime.toUpperCase()}
            </span>
          </div>
        ))}

        <SectionHeader label="MACHINES" count={machines.length} style={{ marginTop: 8 }} />
        {machines.length === 0 && <EmptyHint text="no daemon connected" />}
        {machines.map((m) => (
          <div key={m.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '4px 14px',
            fontSize: 12,
          }}>
            <span style={{
              width: 8,
              height: 8,
              background: m.status === 'online' ? '#00c853' : '#555',
              border: '1.5px solid #000',
              flexShrink: 0,
            }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
              {m.hostname}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ label, count, style }: { label: string; count: number; style?: React.CSSProperties }) {
  return (
    <div style={{ ...S.sectionHeader, ...style }}>
      <span>{label}</span>
      {count > 0 && (
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          background: '#000',
          color: '#FFD700',
          padding: '1px 5px',
          minWidth: 18,
          textAlign: 'center',
        }}>
          {count}
        </span>
      )}
    </div>
  );
}

function ChannelItem({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 14px',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        background: active ? '#FF4D8D' : 'transparent',
        color: active ? '#fff' : '#000',
        borderLeft: active ? '3px solid #000' : '3px solid transparent',
        borderRight: active ? '3px solid #000' : '3px solid transparent',
        margin: '1px 4px',
      }}
    >
      <span style={{ fontSize: 14, opacity: 0.7 }}>#</span>
      {name}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ padding: '3px 14px', fontSize: 11, opacity: 0.5, fontStyle: 'italic' }}>{text}</div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'idle' || status === 'running' ? '#00c853'
    : status === 'working' ? '#FFD700'
    : status === 'starting' ? '#2196f3'
    : status === 'error' ? '#f44336'
    : '#888';
  return (
    <span style={{
      width: 8,
      height: 8,
      background: color,
      border: '1.5px solid #000',
      flexShrink: 0,
      display: 'inline-block',
    }} />
  );
}
