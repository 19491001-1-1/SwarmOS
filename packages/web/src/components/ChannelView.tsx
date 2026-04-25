import { useEffect, useRef } from 'react';
import type { Agent, AgentActivity, Message } from '../api.js';
import { MessageContent } from './MessageContent.js';
import { PresenceAvatar } from './PresenceAvatar.js';
import { t } from '../i18n.js';

type Props = {
  channelName: string;
  messages: Message[];
  agents: Agent[];
  activitiesByAgent: Record<string, AgentActivity[]>;
  onCreateTask?: (messageId: string) => void;
  onOpenThread?: (message: Message) => void;
};

export function ChannelView({ channelName, messages, agents, activitiesByAgent, onCreateTask, onOpenThread }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      minHeight: 0,
      fontFamily: "'Courier New', monospace",
    }}>
      {/* Channel header */}
      <div style={{
        height: 48,
        padding: '0 16px',
        borderBottom: '2px solid #000',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: '#fff',
        flexShrink: 0,
      }}>
        <div style={{
          width: 28,
          height: 28,
          border: '2px solid #000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 16,
          background: '#FFD700',
        }}>
          #
        </div>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{channelName}</span>
        <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>— chat channel</span>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        background: '#fbfbf7',
      }}>
        {messages.length === 0 && (
          <div style={{
            color: '#aaa',
            fontSize: 12,
            textAlign: 'center',
            marginTop: 48,
            border: '2px dashed #ddd',
            padding: '20px',
          }}>
            [ NO MESSAGES YET — START THE CONVERSATION ]
          </div>
        )}
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const grouped = prev && prev.senderName === msg.senderName &&
            new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000;
          const agent = msg.agentId ? agents.find((candidate) => candidate.id === msg.agentId) : undefined;
          const latestActivity = msg.agentId ? activitiesByAgent[msg.agentId]?.[0] : undefined;

          return (
            <div key={msg.id} className="message-row" style={{
              display: 'flex',
              gap: 10,
              padding: grouped ? '1px 0 1px 46px' : '8px 0 2px',
              maxWidth: 1040,
            }}>
              {!grouped && (
                <PresenceAvatar
                  name={msg.senderName}
                  isAgent={!!msg.agentId}
                  status={agent?.status as any}
                  latestActivity={latestActivity}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {!grouped && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{msg.senderName}</span>
                    <span style={{ fontSize: 10, color: '#999', fontFamily: "'Courier New', monospace" }}>
                      {formatTime(msg.createdAt)}
                    </span>
                    <div className="message-actions" style={{ marginLeft: 'auto', display: 'flex', gap: 4, opacity: 0.18 }}>
                    {onOpenThread && (
                      <button
                        onClick={() => onOpenThread(msg)}
                        title={t('message.replyInThread')}
                        style={messageActionStyle}
                      >
                        {t('message.replyInThread')}
                      </button>
                    )}
                    {onCreateTask && (
                      <button
                        onClick={() => onCreateTask(msg.id)}
                        title={t('message.createTask')}
                        style={messageActionStyle}
                      >
                        {t('message.createTask')}
                      </button>
                    )}
                    </div>
                  </div>
                )}
                <MessageContent content={msg.content} mentions={msg.mentions} />
                {msg.replyCount ? (
                  <button
                    onClick={() => onOpenThread?.(msg)}
                    style={{
                      marginTop: 4,
                      border: 'none',
                      background: 'transparent',
                      color: '#6b4f00',
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: "'Courier New', monospace",
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {t('thread.replies', { count: msg.replyCount })}{msg.latestReplyAt ? ` · ${formatTime(msg.latestReplyAt)}` : ''}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const messageActionStyle: React.CSSProperties = {
  border: '1px solid #c8c8b8',
  background: '#fff',
  minHeight: 20,
  padding: '0 6px',
  fontSize: 10,
  fontWeight: 700,
  fontFamily: "'Courier New', monospace",
  cursor: 'pointer',
  borderRadius: 3,
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
