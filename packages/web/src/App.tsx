import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { ChannelView } from './components/ChannelView.js';
import { Composer } from './components/Composer.js';
import { AgentPanel } from './components/AgentPanel.js';
import { AgentDetailPanel } from './components/AgentDetailPanel.js';
import type { Channel, Message, Agent, Machine, AgentActivity, VersionInfo } from './api.js';
import { WEB_COMMIT_SHA, WEB_VERSION, buildWsUrl, getChannels, getMessages, sendMessage, getAgents, getMachines, getAgentActivities, getHubVersion } from './api.js';

export function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [hubVersion, setHubVersion] = useState<VersionInfo | undefined>();
  const [activitiesByAgent, setActivitiesByAgent] = useState<Record<string, AgentActivity[]>>({});
  const [selectedChannel, setSelectedChannel] = useState('general');
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const wsRef = useRef<WebSocket | null>(null);

  const loadChannels = useCallback(async () => {
    const data = await getChannels();
    setChannels(data);
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    const data = await getMessages(channelId);
    setMessages(data);
  }, []);

  const loadAgents = useCallback(async () => {
    const data = await getAgents();
    setAgents(data);
  }, []);

  const loadMachines = useCallback(async () => {
    const data = await getMachines();
    setMachines(data);
  }, []);

  useEffect(() => {
    loadChannels();
    loadAgents();
    loadMachines();
    getHubVersion().then(setHubVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadMessages(selectedChannel);
  }, [selectedChannel]);

  useEffect(() => {
    if (!selectedAgentId) return;
    getAgentActivities(selectedAgentId).then((data) => {
      setActivitiesByAgent((prev) => ({ ...prev, [selectedAgentId]: data }));
    });
  }, [selectedAgentId]);

  // WebSocket for real-time updates
  useEffect(() => {
    const wsUrl = buildWsUrl('/ws');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'message:new') {
        if (msg.message.channelId === selectedChannel) {
          setMessages((prev) => [...prev, msg.message]);
        }
      } else if (msg.type === 'agent:update') {
        setAgents((prev) => prev.map((a) => (a.id === msg.agent.id ? msg.agent : a)));
      } else if (msg.type === 'agent:activity') {
        setActivitiesByAgent((prev) => {
          const current = prev[msg.agentId] ?? [];
          if (current.some((activity) => activity.id === msg.activity.id)) return prev;
          return { ...prev, [msg.agentId]: [msg.activity, ...current].slice(0, 200) };
        });
      } else if (msg.type === 'machine:update') {
        setMachines((prev) => {
          const exists = prev.find((m) => m.id === msg.machine.id);
          if (exists) return prev.map((m) => (m.id === msg.machine.id ? msg.machine : m));
          return [...prev, msg.machine];
        });
      }
    };

    return () => ws.close();
  }, [selectedChannel]);

  const handleSend = async (content: string, agentId?: string) => {
    await sendMessage(selectedChannel, 'user', content, agentId);
  };

  const selectedChannelObj = channels.find((c) => c.id === selectedChannel);
  const selectedAgent = selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : undefined;

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Courier New', monospace", background: '#fafaf5' }}>
      <Sidebar
        channels={channels}
        agents={agents}
        machines={machines}
        selectedChannel={selectedChannel}
        selectedAgentId={selectedAgentId}
        webVersion={{ component: 'web', version: WEB_VERSION, commit: WEB_COMMIT_SHA || undefined }}
        hubVersion={hubVersion}
        onSelectChannel={(id) => { setSelectedChannel(id); setSelectedAgentId(undefined); }}
        onSelectAgent={(id) => { setSelectedAgentId(id); }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <ChannelView
          channelName={selectedChannelObj?.name ?? selectedChannel}
          messages={messages}
        />
        <Composer agents={agents} channelName={selectedChannelObj?.name ?? selectedChannel} onSend={handleSend} />
      </div>
      {selectedAgent ? (
        <AgentDetailPanel
          agent={selectedAgent}
          activities={activitiesByAgent[selectedAgent.id] ?? []}
          onClose={() => setSelectedAgentId(undefined)}
        />
      ) : (
        <AgentPanel agents={agents} machines={machines} onAgentsChange={loadAgents} />
      )}
    </div>
  );
}
