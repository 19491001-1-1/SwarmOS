import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { ChannelView } from './components/ChannelView.js';
import { Composer } from './components/Composer.js';
import { AgentPanel } from './components/AgentPanel.js';
import type { Channel, Message, Agent, Machine } from './api.js';
import { getChannels, getMessages, sendMessage, getAgents, getMachines } from './api.js';

export function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('general');
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
  }, []);

  useEffect(() => {
    loadMessages(selectedChannel);
  }, [selectedChannel]);

  // WebSocket for real-time updates
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
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

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Courier New', monospace", background: '#fafaf5' }}>
      <Sidebar
        channels={channels}
        agents={agents}
        machines={machines}
        selectedChannel={selectedChannel}
        onSelectChannel={(id) => { setSelectedChannel(id); }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <ChannelView
          channelName={selectedChannelObj?.name ?? selectedChannel}
          messages={messages}
        />
        <Composer agents={agents} channelName={selectedChannelObj?.name ?? selectedChannel} onSend={handleSend} />
      </div>
      <AgentPanel agents={agents} machines={machines} onAgentsChange={loadAgents} />
    </div>
  );
}
