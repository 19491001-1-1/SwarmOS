import type { AgentActivity } from '../api.js';
import type { CSSProperties } from 'react';
import { t } from '../i18n.js';

type PresenceStatus = 'inactive' | 'starting' | 'running' | 'working' | 'idle' | 'error';

type Props = {
  name: string;
  isAgent: boolean;
  status?: PresenceStatus;
  latestActivity?: AgentActivity;
  size?: number;
  onClick?: () => void;
};

const AVATAR_PALETTES = [
  ['#FF4D8D', '#FFD700', '#00c853', '#2196f3'],
  ['#7c3aed', '#FFD700', '#FF4D8D', '#fff'],
  ['#00c853', '#2196f3', '#FFD700', '#000'],
  ['#f44336', '#FFD700', '#fff', '#000'],
];

const PHOSPHOR_GREEN = '#00ff41';

export function PresenceAvatar({ name, isAgent, status, latestActivity, size = 36, onClick }: Props) {
  const label = presenceLabel(status, latestActivity, isAgent);
  const color = presenceColor(status, latestActivity, isAgent);
  const active = status === 'working' || latestActivity?.type === 'thinking' || latestActivity?.type === 'working';
  const idx = (name.charCodeAt(0) + name.charCodeAt(1 % Math.max(name.length, 1))) % AVATAR_PALETTES.length;
  const palette = AVATAR_PALETTES[idx];
  const hash = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const grid = Array.from({ length: 16 }, (_, i) => palette[(hash * (i + 1) * 7) % palette.length]);
  const frameStyle: CSSProperties = {
    position: 'relative',
    width: size,
    height: size,
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
  };

  const content = (
    <>
      <div style={{
        width: size,
        height: size,
        border: '1.5px solid #111',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        overflow: 'hidden',
        background: isAgent ? '#7c3aed' : '#1a6b4a',
      }}>
        {grid.map((cellColor, i) => <div key={i} style={{ background: cellColor }} />)}
      </div>
      <span style={{
        position: 'absolute',
        right: -1,
        bottom: -1,
        width: Math.max(9, Math.round(size * 0.28)),
        height: Math.max(9, Math.round(size * 0.28)),
        borderRadius: 99,
        border: '2px solid #fff',
        background: color,
        boxShadow: active ? `0 0 0 2px ${color}55` : 'none',
      }} />
    </>
  );

  const className = active ? 'presence-avatar presence-avatar-active' : 'presence-avatar';
  if (!onClick) {
    return (
      <span className={className} style={frameStyle} title={label}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      style={frameStyle}
      title={label}
    >
      {content}
    </button>
  );
}

export function presenceLabel(status?: PresenceStatus, latestActivity?: AgentActivity, isAgent = true): string {
  if (!isAgent) return t('presence.you');
  if (latestActivity?.type === 'thinking') return t('presence.thinking');
  if (latestActivity?.type === 'working') return t('presence.working');
  if (status === 'working') return t('presence.working');
  if (status === 'starting') return t('presence.starting');
  if (status === 'running') return t('presence.online');
  if (status === 'idle') return t('presence.idle');
  if (status === 'error') return t('presence.error');
  return t('presence.offline');
}

function presenceColor(status?: PresenceStatus, latestActivity?: AgentActivity, isAgent = true): string {
  if (!isAgent) return '#00c853';
  if (latestActivity?.type === 'thinking') return '#2196f3';
  if (latestActivity?.type === 'working') return PHOSPHOR_GREEN;
  if (status === 'working') return PHOSPHOR_GREEN;
  if (status === 'starting') return '#ffb300';
  if (status === 'running') return '#00c853';
  if (status === 'idle') return '#7aa874';
  if (status === 'error') return '#e53935';
  return '#9e9e9e';
}
