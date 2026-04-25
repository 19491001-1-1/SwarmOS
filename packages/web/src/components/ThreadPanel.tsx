import type { Agent, AgentActivity, Message } from '../api.js';
import { MessageContent } from './MessageContent.js';
import { PresenceAvatar } from './PresenceAvatar.js';
import { Composer } from './Composer.js';
import { t } from '../i18n.js';

type Props = {
  root: Message;
  replies: Message[];
  agents: Agent[];
  activitiesByAgent: Record<string, AgentActivity[]>;
  onClose: () => void;
  onSend: (content: string, agentId?: string) => void;
};

export function ThreadPanel({ root, replies, agents, activitiesByAgent, onClose, onSend }: Props) {
  return (
    <aside style={{
      width: 340,
      maxWidth: '42vw',
      borderLeft: '1px solid #d7d7ca',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{
        height: 48,
        borderBottom: '1px solid #d7d7ca',
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <strong>{t('thread.title')}</strong>
        <button onClick={onClose} style={smallButtonStyle}>{t('thread.close')}</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#fbfbf7' }}>
        <ThreadMessage message={root} agents={agents} activitiesByAgent={activitiesByAgent} root />
        <div style={{ height: 1, background: '#ddd', margin: '12px 0' }} />
        {replies.map((reply) => (
          <ThreadMessage key={reply.id} message={reply} agents={agents} activitiesByAgent={activitiesByAgent} />
        ))}
        {replies.length === 0 ? (
          <div style={{ color: '#888', fontSize: 12, padding: '12px 0' }}>{t('thread.replyPlaceholder')}</div>
        ) : null}
      </div>
      <Composer agents={agents} channelName={t('thread.title')} onSend={onSend} />
    </aside>
  );
}

function ThreadMessage({ message, agents, activitiesByAgent, root = false }: {
  message: Message;
  agents: Agent[];
  activitiesByAgent: Record<string, AgentActivity[]>;
  root?: boolean;
}) {
  const agent = message.agentId ? agents.find((candidate) => candidate.id === message.agentId) : undefined;
  return (
    <div style={{ display: 'flex', gap: 9, padding: root ? '4px 0 8px' : '8px 0' }}>
      <PresenceAvatar
        name={message.senderName}
        isAgent={!!message.agentId}
        status={agent?.status as any}
        latestActivity={message.agentId ? activitiesByAgent[message.agentId]?.[0] : undefined}
        size={30}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
          <strong style={{ fontSize: 12 }}>{message.senderName}</strong>
          <span style={{ fontSize: 10, color: '#888' }}>{formatTime(message.createdAt)}</span>
        </div>
        <MessageContent content={message.content} mentions={message.mentions} />
      </div>
    </div>
  );
}

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid #bbb',
  background: '#fff',
  fontFamily: "'Courier New', monospace",
  fontWeight: 700,
  cursor: 'pointer',
  padding: '4px 7px',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
