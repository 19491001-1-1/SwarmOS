import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { ChannelView } from './components/ChannelView.js';
import { Composer } from './components/Composer.js';
import { AgentPanel } from './components/AgentPanel.js';
import { AgentDetailPanel } from './components/AgentDetailPanel.js';
import { TaskBoard } from './components/TaskBoard.js';
import type { Channel, Message, Agent, Machine, AgentActivity, VersionInfo, Task, Reminder, SearchMessageResult } from './api.js';
import { WEB_COMMIT_SHA, WEB_VERSION, buildWsUrl, getChannels, getMessages, sendMessage, getAgents, getMachines, getAgentActivities, getHubVersion, getTasks, messageToTask, getAgentReminders, createChannel, deleteChannel, searchMessages } from './api.js';

export function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hubVersion, setHubVersion] = useState<VersionInfo | undefined>();
  const [activitiesByAgent, setActivitiesByAgent] = useState<Record<string, AgentActivity[]>>({});
  const [remindersByAgent, setRemindersByAgent] = useState<Record<string, Reminder[]>>({});
  const [selectedView, setSelectedView] = useState<'channel' | 'tasks'>('channel');
  const [selectedChannel, setSelectedChannel] = useState('general');
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const selectedChannelRef = useRef(selectedChannel);

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

  const loadTasks = useCallback(async () => {
    const data = await getTasks();
    setTasks(data);
  }, []);

  const upsertMessage = useCallback((message: Message) => {
    setMessages((prev) => prev.some((candidate) => candidate.id === message.id)
      ? prev.map((candidate) => (candidate.id === message.id ? message : candidate))
      : [...prev, message]);
  }, []);

  useEffect(() => {
    loadChannels();
    loadAgents();
    loadMachines();
    loadTasks();
    getHubVersion().then(setHubVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
    loadMessages(selectedChannel);
  }, [selectedChannel]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!selectedAgentId) return;
    getAgentActivities(selectedAgentId).then((data) => {
      setActivitiesByAgent((prev) => ({ ...prev, [selectedAgentId]: data }));
    });
    getAgentReminders(selectedAgentId).then((data) => {
      setRemindersByAgent((prev) => ({ ...prev, [selectedAgentId]: data }));
    });
  }, [selectedAgentId]);

  // WebSocket for real-time updates. Keep one connection alive and use refs for
  // channel-specific state so channel switching does not churn the socket.
  useEffect(() => {
    let closedByEffect = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectDelay = 1000;

    const refreshCurrentState = () => {
      loadChannels();
      loadAgents();
      loadMachines();
      loadTasks();
      loadMessages(selectedChannelRef.current);
    };

    const connect = () => {
      const ws = new WebSocket(buildWsUrl('/ws'));
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay = 1000;
        refreshCurrentState();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'browser:ping', at: Date.now() }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'message:new') {
          if (msg.message.channelId === selectedChannelRef.current) {
            upsertMessage(msg.message);
          }
        } else if (msg.type === 'agent:update' || msg.type === 'agent:updated') {
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
        } else if (msg.type === 'task:update') {
          setTasks((prev) => {
            const exists = prev.find((task) => task.id === msg.task.id);
            if (exists) return prev.map((task) => (task.id === msg.task.id ? msg.task : task));
            return [...prev, msg.task];
          });
        } else if (msg.type === 'channel:created') {
          setChannels((prev) => prev.some((channel) => channel.id === msg.channel.id) ? prev : [...prev, msg.channel]);
        } else if (msg.type === 'channel:deleted') {
          setChannels((prev) => prev.filter((channel) => channel.id !== msg.channelId));
          if (selectedChannelRef.current === msg.channelId) setSelectedChannel('general');
        } else if (msg.type === 'reminder:update') {
          setRemindersByAgent((prev) => {
            const current = prev[msg.reminder.agentId] ?? [];
            const exists = current.some((reminder) => reminder.id === msg.reminder.id);
            return {
              ...prev,
              [msg.reminder.agentId]: exists
                ? current.map((reminder) => (reminder.id === msg.reminder.id ? msg.reminder : reminder))
                : [...current, msg.reminder],
            };
          });
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onclose = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        if (wsRef.current === ws) wsRef.current = null;
        if (closedByEffect) return;
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [loadAgents, loadChannels, loadMachines, loadMessages, loadTasks, upsertMessage]);

  const handleSend = async (content: string, agentId?: string) => {
    const message = await sendMessage(selectedChannel, 'user', content, agentId);
    if (message.channelId === selectedChannelRef.current) upsertMessage(message);
  };

  const upsertTask = (task: Task) => {
    setTasks((prev) => prev.some((candidate) => candidate.id === task.id)
      ? prev.map((candidate) => (candidate.id === task.id ? task : candidate))
      : [...prev, task]);
  };

  const upsertReminder = (reminder: Reminder) => {
    setRemindersByAgent((prev) => {
      const current = prev[reminder.agentId] ?? [];
      return {
        ...prev,
        [reminder.agentId]: current.some((candidate) => candidate.id === reminder.id)
          ? current.map((candidate) => (candidate.id === reminder.id ? reminder : candidate))
          : [...current, reminder],
      };
    });
  };

  const handleMessageToTask = async (messageId: string) => {
    upsertTask(await messageToTask(messageId, { creatorName: 'user' }));
  };

  const handleCreateChannel = async (name: string) => {
    const channel = await createChannel(name);
    setChannels((prev) => prev.some((candidate) => candidate.id === channel.id) ? prev : [...prev, channel]);
    setSelectedView('channel');
    setSelectedChannel(channel.id);
  };

  const handleDeleteChannel = async (id: string) => {
    await deleteChannel(id);
    setChannels((prev) => prev.filter((channel) => channel.id !== id));
    if (selectedChannel === id) setSelectedChannel('general');
  };

  const selectedChannelObj = channels.find((c) => c.id === selectedChannel);
  const selectedAgent = selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : undefined;

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Courier New', monospace", background: '#fafaf5' }}>
      <Sidebar
        channels={channels}
        agents={agents}
        machines={machines}
        selectedView={selectedView}
        selectedChannel={selectedChannel}
        selectedAgentId={selectedAgentId}
        webVersion={{ component: 'web', version: WEB_VERSION, commit: WEB_COMMIT_SHA || undefined }}
        hubVersion={hubVersion}
        taskCount={tasks.filter((task) => task.status !== 'done').length}
        onSelectTasks={() => { setSelectedView('tasks'); setSelectedAgentId(undefined); }}
        onOpenSearch={() => setSearchOpen(true)}
        onSelectChannel={(id) => { setSelectedView('channel'); setSelectedChannel(id); setSelectedAgentId(undefined); }}
        onCreateChannel={handleCreateChannel}
        onDeleteChannel={handleDeleteChannel}
        onSelectAgent={(id) => { setSelectedAgentId(id); }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {selectedView === 'tasks' ? (
          <TaskBoard
            tasks={tasks}
            channels={channels}
            agents={agents}
            onTaskUpdated={upsertTask}
            onTaskDeleted={(taskId) => setTasks((prev) => prev.filter((task) => task.id !== taskId))}
          />
        ) : (
          <>
            <ChannelView
              channelName={selectedChannelObj?.name ?? selectedChannel}
              messages={messages}
              onCreateTask={handleMessageToTask}
            />
            <Composer agents={agents} channelName={selectedChannelObj?.name ?? selectedChannel} onSend={handleSend} />
          </>
        )}
      </div>
      {selectedAgent ? (
        <AgentDetailPanel
          agent={selectedAgent}
          activities={activitiesByAgent[selectedAgent.id] ?? []}
          reminders={remindersByAgent[selectedAgent.id] ?? []}
          onReminderUpdated={upsertReminder}
          onAgentUpdated={(updated) => setAgents((prev) => prev.map((agent) => (agent.id === updated.id ? updated : agent)))}
          onClose={() => setSelectedAgentId(undefined)}
        />
      ) : (
        <AgentPanel agents={agents} machines={machines} onAgentsChange={loadAgents} />
      )}
      {searchOpen ? (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onSelect={(result) => {
            setSelectedView('channel');
            setSelectedChannel(result.channelId);
            setSearchOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function SearchOverlay({ onClose, onSelect }: { onClose: () => void; onSelect: (result: SearchMessageResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchMessageResult[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      searchMessages(trimmed, 20).then((data) => setResults(data.messages)).catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'start center', paddingTop: 80, zIndex: 10 }}>
      <div style={{ width: 'min(720px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 120px)', overflow: 'auto', background: '#fafaf5', border: '3px solid #000', fontFamily: "'Courier New', monospace" }}>
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages" style={{ width: '100%', boxSizing: 'border-box', border: 'none', borderBottom: '3px solid #000', padding: 14, fontSize: 18, fontFamily: "'Courier New', monospace", fontWeight: 700 }} />
        <div style={{ padding: 10, display: 'grid', gap: 8 }}>
          {results.length === 0 ? <div style={{ border: '2px dashed #999', padding: 18, textAlign: 'center', fontSize: 12 }}>[ NO RESULTS ]</div> : null}
          {results.map((result) => (
            <button key={result.id} onClick={() => onSelect(result)} style={{ border: '2px solid #000', background: '#fff', padding: 10, textAlign: 'left', fontFamily: "'Courier New', monospace", cursor: 'pointer' }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>#{result.channelName} / {new Date(result.createdAt).toLocaleString()}</div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{highlightText(result.content, query)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function highlightText(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark style={{ background: '#FFD700', color: '#000' }}>{text.slice(index, index + trimmed.length)}</mark>
      {text.slice(index + trimmed.length)}
    </>
  );
}
