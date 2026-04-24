import type { Machine } from '../api.js';

type Props = {
  machines: Machine[];
};

export function MachinePanel({ machines }: Props) {
  if (machines.length === 0) {
    return (
      <div style={{ padding: '8px 12px', color: '#666', fontSize: 12 }}>
        No machines connected. Run the daemon to connect.
      </div>
    );
  }

  return (
    <div>
      {machines.map((m) => (
        <div key={m.id} style={{ background: '#1a1a3e', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
            <span>{m.status === 'online' ? '🟢' : '⚫'}</span>
            {m.hostname}
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
            {m.os} · runtimes: {m.runtimes.join(', ') || 'none'}
          </div>
        </div>
      ))}
    </div>
  );
}
