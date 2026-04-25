import { useEffect, useRef } from 'react';
import type { Message } from '../api.js';

type Props = {
  channelName: string;
  messages: Message[];
  onCreateTask?: (messageId: string) => void;
};

// Deterministic pixel avatar colors per name
const AVATAR_PALETTES = [
  ['#FF4D8D', '#FFD700', '#00c853', '#2196f3'],
  ['#7c3aed', '#FFD700', '#FF4D8D', '#fff'],
  ['#00c853', '#2196f3', '#FFD700', '#000'],
  ['#f44336', '#FFD700', '#fff', '#000'],
];

function PixelAvatar({ name, isAgent }: { name: string; isAgent: boolean }) {
  const idx = (name.charCodeAt(0) + name.charCodeAt(1 % name.length)) % AVATAR_PALETTES.length;
  const palette = AVATAR_PALETTES[idx];
  // 4x4 pixel grid pattern based on name hash
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const grid = Array.from({ length: 16 }, (_, i) => palette[(hash * (i + 1) * 7) % palette.length]);

  return (
    <div style={{
      width: 36,
      height: 36,
      border: '2px solid #000',
      flexShrink: 0,
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      overflow: 'hidden',
      background: isAgent ? '#7c3aed' : '#1a6b4a',
    }}>
      {grid.map((color, i) => (
        <div key={i} style={{ background: color }} />
      ))}
    </div>
  );
}

export function ChannelView({ channelName, messages, onCreateTask }: Props) {
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
        background: '#fafaf5',
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

          return (
            <div key={msg.id} style={{
              display: 'flex',
              gap: 10,
              padding: grouped ? '1px 0 1px 46px' : '8px 0 2px',
            }}>
              {!grouped && <PixelAvatar name={msg.senderName} isAgent={!!msg.agentId} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                {!grouped && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{msg.senderName}</span>
                    <span style={{ fontSize: 10, color: '#999', fontFamily: "'Courier New', monospace" }}>
                      {formatTime(msg.createdAt)}
                    </span>
                    {onCreateTask && (
                      <button
                        onClick={() => onCreateTask(msg.id)}
                        title="Create task from message"
                        style={{
                          marginLeft: 'auto',
                          border: '1.5px solid #000',
                          background: '#fff',
                          height: 20,
                          padding: '0 6px',
                          fontSize: 10,
                          fontWeight: 700,
                          fontFamily: "'Courier New', monospace",
                          cursor: 'pointer',
                        }}
                      >
                        {'-> TASK'}
                      </button>
                    )}
                  </div>
                )}
                <div style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: '#111',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
