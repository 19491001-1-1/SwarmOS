import { useState } from 'react';
import type { Agent } from '../api.js';

type Props = {
  agents: Agent[];
  onSwarmInit: (channelId: string, agents: Array<{ agent_id: string; role?: string; allowed_tools?: string[] }>) => Promise<{ swarm_id: string; status: string }>;
  onClose?: () => void;
};

export function SwarmInitPanel({ agents, onSwarmInit, onClose }: Props) {
  const [channelId, setChannelId] = useState('general');
  const [selectedAgents, setSelectedAgents] = useState<Record<string, { role: string; tools: string }>>({});
  const [result, setResult] = useState<{ swarm_id: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) => {
      if (prev[agentId]) {
        const { [agentId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [agentId]: { role: 'developer', tools: '' } };
    });
  };

  const updateRole = (agentId: string, role: string) => {
    setSelectedAgents((prev) => ({
      ...prev,
      [agentId]: { ...prev[agentId], role },
    }));
  };

  const updateTools = (agentId: string, tools: string) => {
    setSelectedAgents((prev) => ({
      ...prev,
      [agentId]: { ...prev[agentId], tools },
    }));
  };

  const handleInit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const agentList = Object.entries(selectedAgents).map(([agent_id, config]) => ({
        agent_id,
        role: config.role,
        allowed_tools: config.tools ? config.tools.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      }));
      const res = await onSwarmInit(channelId, agentList);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Swarm init failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="right-panel swarm-init-panel">
      <div className="swarm-init-header">
        <span className="swarm-init-header-title">▶ SWARM INIT</span>
        {onClose ? (
          <button type="button" onClick={onClose} className="swarm-init-close-button">X</button>
        ) : null}
      </div>
      <div className="swarm-init-body">
        <div className="swarm-init-field">
          <label className="swarm-init-label">channel_id</label>
          <input
            className="swarm-init-input"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="general"
          />
        </div>
        <div className="swarm-init-field">
          <label className="swarm-init-label">Agents</label>
          <div className="swarm-init-agent-list">
            {agents.length === 0 ? (
              <div className="swarm-init-empty">No agents available</div>
            ) : (
              agents.map((agent) => {
                const selected = !!selectedAgents[agent.id];
                return (
                  <div key={agent.id} className={`swarm-init-agent-item ${selected ? 'swarm-init-agent-selected' : ''}`}>
                    <label className="swarm-init-agent-check-label">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleAgent(agent.id)}
                      />
                      <span>{agent.displayName ?? agent.name ?? agent.id}</span>
                    </label>
                    {selected ? (
                      <div className="swarm-init-agent-config">
                        <div className="swarm-init-config-row">
                          <span className="swarm-init-config-label">role</span>
                          <select
                            className="swarm-init-select"
                            value={selectedAgents[agent.id].role}
                            onChange={(e) => updateRole(agent.id, e.target.value)}
                          >
                            <option value="developer">developer</option>
                            <option value="reviewer">reviewer</option>
                            <option value="observer">observer</option>
                          </select>
                        </div>
                        <div className="swarm-init-config-row">
                          <span className="swarm-init-config-label">tools</span>
                          <input
                            className="swarm-init-input swarm-init-tools-input"
                            value={selectedAgents[agent.id].tools}
                            onChange={(e) => updateTools(agent.id, e.target.value)}
                            placeholder="file_write, exec_cmd"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <button
          type="button"
          className="swarm-init-button"
          onClick={handleInit}
          disabled={loading || Object.keys(selectedAgents).length === 0}
        >
          {loading ? 'INITIALIZING...' : 'INIT'}
        </button>
        {error ? <div className="swarm-init-error">{error}</div> : null}
        {result ? (
          <div className="swarm-init-result">
            <div>swarm_id: {result.swarm_id}</div>
            <div>status: {result.status}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
