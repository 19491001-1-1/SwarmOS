import { useState, useRef } from 'react';
import type { Agent } from '../api.js';
import { t } from '../i18n.js';

type Props = {
  agents: Agent[];
  channelName?: string;
  onSend: (content: string, agentId?: string) => void;
};

export function Composer({ agents, channelName, onSend }: Props) {
  const [content, setContent] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [pressing, setPressing] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!content.trim()) return;
    onSend(content.trim(), selectedAgent || undefined);
    setContent('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key) && !e.nativeEvent.isComposing) {
      const options = mentionOptions(agents);
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((index) => (index + 1) % options.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((index) => (index - 1 + options.length) % options.length);
      } else {
        e.preventDefault();
        insertMention(options[mentionIndex]?.label ?? 'user');
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertMention = (label: string) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? content.length;
    const before = content.slice(0, cursor).replace(/@[\p{L}\p{N}_-]*$/u, '');
    const after = content.slice(cursor);
    const next = `${before}@${label} ${after}`;
    setContent(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      textarea?.focus();
      const pos = `${before}@${label} `.length;
      textarea?.setSelectionRange(pos, pos);
    });
  };

  const runningAgents = agents.filter((a) => ['running', 'idle', 'working'].includes(a.status));
  const canSend = content.trim().length > 0;

  return (
    <div style={{
      padding: '10px 16px 14px',
      background: '#fff',
      borderTop: '2px solid #000',
      fontFamily: "'Courier New', monospace",
      flexShrink: 0,
    }}>
      {/* Agent selector */}
      {runningAgents.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
          fontSize: 11,
          fontWeight: 700,
        }}>
          <span style={{ color: '#888', letterSpacing: '0.5px' }}>TO:</span>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            style={{
              fontFamily: "'Courier New', monospace",
              fontSize: 11,
              fontWeight: 700,
              border: '2px solid #000',
              borderRadius: 0,
              background: selectedAgent ? '#FFD700' : '#f5f5f5',
              color: '#000',
              padding: '2px 6px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">[ BROADCAST ]</option>
            {runningAgents.map((a) => (
              <option key={a.id} value={a.id}>@{a.displayName ?? a.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Input row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', position: 'relative' }}>
        {mentionOpen ? (
          <div style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            marginBottom: 6,
            minWidth: 220,
            border: '1.5px solid #111',
            background: '#fff',
            boxShadow: '2px 2px 0 #111',
            zIndex: 5,
          }}>
            {mentionOptions(agents).map((option, index) => (
              <button
                key={`${option.type}:${option.id}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(option.label);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  border: 'none',
                  background: index === mentionIndex ? '#FFD700' : '#fff',
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontFamily: "'Courier New', monospace",
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                @{option.label}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            const cursor = e.currentTarget.selectionStart;
            setMentionOpen(/@[\p{L}\p{N}_-]*$/u.test(e.target.value.slice(0, cursor)));
            setMentionIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('composer.placeholder').replace('{channel}', channelName ?? 'channel')}
          rows={2}
          style={{
            flex: 1,
            fontFamily: "'Courier New', monospace",
            fontSize: 13,
            border: '2px solid #000',
            borderRadius: 0,
            padding: '8px 10px',
            resize: 'none',
            outline: 'none',
            background: '#fff',
            color: '#000',
            lineHeight: 1.5,
          }}
          onFocus={(e) => { e.currentTarget.style.outline = '2px solid #FF4D8D'; e.currentTarget.style.outlineOffset = '-2px'; }}
          onBlur={(e) => { e.currentTarget.style.outline = 'none'; }}
        />
        <button
          onClick={handleSend}
          onMouseDown={() => setPressing(true)}
          onMouseUp={() => setPressing(false)}
          onMouseLeave={() => setPressing(false)}
          disabled={!canSend}
          style={{
            fontFamily: "'Courier New', monospace",
            fontWeight: 700,
            fontSize: 13,
            border: '2px solid #000',
            borderRadius: 0,
            padding: '8px 18px',
            cursor: canSend ? 'pointer' : 'not-allowed',
            background: canSend ? '#FF4D8D' : '#eee',
            color: canSend ? '#fff' : '#aaa',
            boxShadow: canSend && !pressing ? '3px 3px 0 #000' : 'none',
            transform: pressing && canSend ? 'translate(2px, 2px)' : 'none',
            transition: 'box-shadow 0.05s, transform 0.05s',
            letterSpacing: '0.5px',
            alignSelf: 'stretch',
          }}
        >
          {t('composer.send')} ▶
        </button>
      </div>
    </div>
  );
}

function mentionOptions(agents: Agent[]): Array<{ type: 'agent' | 'user'; id: string; label: string }> {
  return [
    { type: 'user', id: 'user', label: 'user' },
    ...agents.map((agent) => ({ type: 'agent' as const, id: agent.id, label: agent.displayName ?? agent.name })),
  ];
}
