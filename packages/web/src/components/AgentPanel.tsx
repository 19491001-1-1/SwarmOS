import { useState, useEffect } from 'react';
import type { Agent, Machine } from '../api.js';
import { createAgent, startAgent, stopAgent } from '../api.js';

type Props = {
  agents: Agent[];
  machines: Machine[];
  onAgentsChange: () => void;
  onClose?: () => void;
};

const FONT = "'Courier New', monospace";

const inputStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 12,
  border: '2px solid #000',
  borderRadius: 0,
  padding: '5px 8px',
  background: '#fff',
  color: '#000',
  width: '100%',
  outline: 'none',
};

export function AgentPanel({ agents, machines, onAgentsChange, onClose }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    runtime: 'claude' as 'claude' | 'codex' | 'gemini',
    model: '',
    systemPrompt: '',
    machineId: '',
  });
  const [loading, setLoading] = useState(false);

  const onlineMachines = machines.filter((m) => m.status === 'online');

  useEffect(() => {
    if (!form.machineId && onlineMachines.length > 0) {
      setForm((f) => ({ ...f, machineId: onlineMachines[0].id }));
    }
  }, [machines]);

  const handleCreate = async () => {
    if (!form.name) return;
    setLoading(true);
    try {
      await createAgent({
        name: form.name,
        displayName: form.displayName || undefined,
        runtime: form.runtime,
        model: form.model || undefined,
        systemPrompt: form.systemPrompt || undefined,
        machineId: form.machineId || undefined,
      });
      setShowForm(false);
      setForm({ name: '', displayName: '', runtime: 'claude', model: '', systemPrompt: '', machineId: '' });
      onAgentsChange();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="right-panel right-panel-agents" style={{
      width: 280,
      background: '#fafaf5',
      borderLeft: '2px solid #000',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      fontFamily: FONT,
    }}>
      {/* Header */}
      <div style={{
        height: 48,
        padding: '0 12px',
        borderBottom: '2px solid #000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#fff',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.5px' }}>▶ AGENTS</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <PxButton
            onClick={() => setShowForm(!showForm)}
            bg={showForm ? '#FFD700' : '#000'}
            color={showForm ? '#000' : '#FFD700'}
            small
          >
            {showForm ? '✕ CANCEL' : '+ NEW'}
          </PxButton>
          {onClose ? (
            <PxButton onClick={onClose} bg="#fff" color="#000" small>
              X
            </PxButton>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {/* Create form */}
        {showForm && (
          <div style={{
            border: '2px solid #000',
            background: '#fff',
            padding: 10,
            marginBottom: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            <FieldLabel>NAME *</FieldLabel>
            <input
              placeholder="my-agent"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              style={inputStyle}
            />
            <FieldLabel>DISPLAY NAME</FieldLabel>
            <input
              placeholder="My Agent"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              style={inputStyle}
            />
            <FieldLabel>RUNTIME</FieldLabel>
            <select
              value={form.runtime}
              onChange={(e) => setForm((f) => ({ ...f, runtime: e.target.value as any }))}
              style={inputStyle}
            >
              <option value="claude">CLAUDE</option>
              <option value="codex">CODEX</option>
              <option value="gemini">GEMINI</option>
            </select>
            <FieldLabel>MODEL (OPTIONAL)</FieldLabel>
            <input
              placeholder="e.g. claude-opus-4-5"
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              style={inputStyle}
            />
            <FieldLabel>SYSTEM PROMPT</FieldLabel>
            <textarea
              placeholder="You are a helpful assistant..."
              value={form.systemPrompt}
              onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.4 }}
            />
            {onlineMachines.length > 0 && (
              <>
                <FieldLabel>MACHINE</FieldLabel>
                <select
                  value={form.machineId}
                  onChange={(e) => setForm((f) => ({ ...f, machineId: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">-- none --</option>
                  {onlineMachines.map((m) => (
                    <option key={m.id} value={m.id}>{m.hostname}</option>
                  ))}
                </select>
              </>
            )}
            <div style={{ marginTop: 4 }}>
              <PxButton
                onClick={handleCreate}
                disabled={loading || !form.name}
                bg={loading || !form.name ? '#ccc' : '#FF4D8D'}
                color="#fff"
                full
              >
                {loading ? 'CREATING...' : '▶ CREATE AGENT'}
              </PxButton>
            </div>
          </div>
        )}

        {/* Agent list */}
        {agents.length === 0 && !showForm && (
          <div style={{
            fontSize: 11,
            color: '#aaa',
            textAlign: 'center',
            marginTop: 20,
            border: '2px dashed #ccc',
            padding: 16,
            lineHeight: 1.8,
          }}>
            [ NO AGENTS ]<br />
            <span>click + NEW to create one</span>
          </div>
        )}
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} onStart={() => { startAgent(a.id).then(onAgentsChange); }} onStop={() => { stopAgent(a.id).then(onAgentsChange); }} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent, onStart, onStop }: { agent: Agent; onStart: () => void; onStop: () => void }) {
  const statusColor = agent.status === 'idle' || agent.status === 'running' ? '#00c853'
    : agent.status === 'working' ? '#FFD700'
    : agent.status === 'starting' ? '#2196f3'
    : agent.status === 'error' ? '#f44336'
    : '#ccc';

  const runtimeBg: Record<string, string> = { claude: '#e8f0ff', codex: '#e8f5e9', gemini: '#fff8e1' };

  return (
    <div style={{
      border: '2px solid #000',
      background: '#fff',
      padding: '8px 10px',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <span style={{
          width: 9,
          height: 9,
          background: statusColor,
          border: '1.5px solid #000',
          flexShrink: 0,
        }} />
        <span style={{ fontWeight: 700, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.displayName ?? agent.name}
        </span>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          border: '1.5px solid #000',
          padding: '1px 5px',
          background: runtimeBg[agent.runtime] ?? '#f5f5f5',
          letterSpacing: '0.5px',
        }}>
          {agent.runtime.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 7, letterSpacing: '0.3px' }}>
        STATUS: {agent.status.toUpperCase()} · AUTO START: {agent.autoStart ? 'ON' : 'OFF'}
      </div>
      {['inactive', 'error'].includes(agent.status) ? (
        <PxButton onClick={onStart} bg="#00c853" color="#fff" small>▶ START</PxButton>
      ) : (
        <PxButton onClick={onStop} bg="#f44336" color="#fff" small>■ STOP</PxButton>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', color: '#666', marginTop: 2 }}>
      {children}
    </div>
  );
}

function PxButton({ onClick, bg, color, children, disabled, small, full }: {
  onClick: () => void;
  bg: string;
  color: string;
  children: React.ReactNode;
  disabled?: boolean;
  small?: boolean;
  full?: boolean;
}) {
  const [pressing, setPressing] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => setPressing(true)}
      onMouseUp={() => setPressing(false)}
      onMouseLeave={() => setPressing(false)}
      style={{
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: small ? 11 : 12,
        border: '2px solid #000',
        borderRadius: 0,
        padding: small ? '3px 10px' : '6px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? '#ccc' : bg,
        color: disabled ? '#888' : color,
        boxShadow: !disabled && !pressing ? '2px 2px 0 #000' : 'none',
        transform: pressing && !disabled ? 'translate(2px, 2px)' : 'none',
        transition: 'box-shadow 0.05s, transform 0.05s',
        letterSpacing: '0.5px',
        width: full ? '100%' : undefined,
      }}
    >
      {children}
    </button>
  );
}
