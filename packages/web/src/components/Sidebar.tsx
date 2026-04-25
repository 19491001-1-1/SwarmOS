import type { Channel, Agent, Machine, VersionInfo } from '../api.js';

type Props = {
  channels: Channel[];
  agents: Agent[];
  machines: Machine[];
  selectedView: 'channel' | 'tasks';
  selectedChannel: string;
  selectedAgentId?: string;
  webVersion: VersionInfo;
  hubVersion?: VersionInfo;
  taskCount: number;
  onSelectTasks: () => void;
  onSelectChannel: (id: string) => void;
  onSelectAgent: (id: string) => void;
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
    letterSpacing: 0,
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

export function Sidebar({ channels, agents, machines, selectedView, selectedChannel, selectedAgentId, webVersion, hubVersion, taskCount, onSelectTasks, onSelectChannel, onSelectAgent }: Props) {
  return (
    <div style={S.sidebar}>
      <div style={S.workspaceName}>
        <span>▶ WORKSPACE</span>
        <span title={versionTitle(webVersion, hubVersion)} style={{ fontSize: 10, fontWeight: 400, opacity: 0.65 }}>
          web {shortVersion(webVersion.version)}
        </span>
      </div>

      <div style={{ padding: '4px 0' }}>
        <button onClick={onSelectTasks} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: 'calc(100% - 8px)',
          margin: '6px 4px 8px',
          padding: '7px 10px',
          fontSize: 13,
          fontFamily: "'Courier New', monospace",
          fontWeight: 700,
          border: 'none',
          borderLeft: selectedView === 'tasks' ? '3px solid #000' : '3px solid transparent',
          borderRight: selectedView === 'tasks' ? '3px solid #000' : '3px solid transparent',
          background: selectedView === 'tasks' ? '#000' : '#fff',
          color: selectedView === 'tasks' ? '#FFD700' : '#000',
          cursor: 'pointer',
          textAlign: 'left',
        }}>
          <span style={{ flex: 1 }}>TASKS</span>
          <span style={{ fontSize: 10 }}>{taskCount}</span>
        </button>

        <SectionHeader label="CHANNELS" count={channels.length} />
        {channels.map((ch) => (
          <ChannelItem
            key={ch.id}
            name={ch.name}
            active={selectedView === 'channel' && selectedChannel === ch.id}
            onClick={() => onSelectChannel(ch.id)}
          />
        ))}

        <SectionHeader label="AGENTS" count={agents.length} style={{ marginTop: 8 }} />
        {agents.length === 0 && <EmptyHint text="no agents" />}
        {agents.map((a) => (
          <button key={a.id} onClick={() => onSelectAgent(a.id)} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            width: 'calc(100% - 8px)',
            margin: '1px 4px',
            padding: '5px 10px',
            fontSize: 12,
            fontFamily: "'Courier New', monospace",
            border: 'none',
            borderLeft: selectedAgentId === a.id ? '3px solid #000' : '3px solid transparent',
            borderRight: selectedAgentId === a.id ? '3px solid #000' : '3px solid transparent',
            background: selectedAgentId === a.id ? '#fff' : 'transparent',
            color: '#000',
            cursor: 'pointer',
            textAlign: 'left',
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
          </button>
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
      <div style={{ marginTop: 'auto', padding: '8px 14px 12px', fontSize: 10, lineHeight: 1.5, opacity: 0.72 }}>
        <div>WEB {shortVersion(webVersion.version)}</div>
        <div>HUB {hubVersion ? shortVersion(hubVersion.version) : '...'}</div>
      </div>
    </div>
  );
}

function shortVersion(version: string): string {
  return version.length > 12 ? `${version.slice(0, 12)}` : version;
}

function versionTitle(webVersion: VersionInfo, hubVersion?: VersionInfo): string {
  const web = `web ${webVersion.version}${webVersion.commit ? ` (${webVersion.commit})` : ''}`;
  const hub = hubVersion ? `hub ${hubVersion.version}${hubVersion.commit ? ` (${hubVersion.commit})` : ''}` : 'hub loading';
  return `${web}\n${hub}`;
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
