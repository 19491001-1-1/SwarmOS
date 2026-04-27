import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Mention } from '../api.js';

type Props = {
  content: string;
  mentions?: Mention[];
  currentUserName?: string;
  onOpenAgent?: (agentId: string) => void;
};

export function normalizeMessageContent(content: string): string {
  return content.replace(/\\n/g, '\n');
}

export function MessageContent({ content, mentions = [], currentUserName = 'user', onOpenAgent }: Props) {
  const normalized = applyMentionLinks(normalizeMessageContent(content), mentions);
  return (
    <div style={contentStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#mention:') || href?.startsWith('mention:')) {
              const mentionHref = href.startsWith('#') ? href.slice(1) : href;
              const [, type, id] = mentionHref.split(':');
              const isCurrentUser = type === 'user' && id === currentUserName;
              if (type === 'agent' && id) {
                return (
                  <button
                    type="button"
                    onClick={() => onOpenAgent?.(id)}
                    style={mentionStyle({ actionable: true, currentUser: false })}
                  >
                    {children}
                  </button>
                );
              }
              return <span style={mentionStyle({ actionable: false, currentUser: isCurrentUser })}>{children}</span>;
            }
            return <a href={href} target="_blank" rel="noreferrer" style={{ color: '#0b63ce', overflowWrap: 'anywhere' }}>{children}</a>;
          },
          code: ({ children, className }) => className
            ? <code style={codeBlockStyle}>{children}</code>
            : <code style={inlineCodeStyle}>{children}</code>,
          table: ({ children }) => <div style={{ overflowX: 'auto', maxWidth: '100%' }}><table style={tableStyle}>{children}</table></div>,
          th: ({ children }) => <th style={cellStyle(true)}>{children}</th>,
          td: ({ children }) => <td style={cellStyle(false)}>{children}</td>,
          blockquote: ({ children }) => <blockquote style={quoteStyle}>{children}</blockquote>,
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

function applyMentionLinks(content: string, mentions: Mention[]): string {
  const mentionByLabel = new Map(mentions.map((mention) => [mention.label, mention]));
  const mentionPattern = /(^|[^\w\u4e00-\u9fa5])@([\w\u4e00-\u9fa5]+)/g;
  return content.replace(mentionPattern, (_match, prefix: string, label: string) => {
    const mention = mentionByLabel.get(label) ?? {
      type: 'user' as const,
      id: label,
      label,
    };
    return `${prefix}${formatMentionLink(mention)}`;
  });
}

function formatMentionLink(mention: Mention): string {
  return `[@${mention.label}](#mention:${mention.type}:${mention.id})`;
}

const contentStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.68,
  color: '#111',
  overflowWrap: 'anywhere',
  maxWidth: 980,
};

const inlineCodeStyle: React.CSSProperties = {
  background: '#f1f1e8',
  border: '1px solid #ddd',
  padding: '1px 4px',
  fontSize: 12,
};

const codeBlockStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  overflowX: 'auto',
  background: '#171717',
  color: '#f5f5f5',
  padding: 10,
  borderRadius: 4,
  lineHeight: 1.5,
};

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  minWidth: 420,
  margin: '8px 0',
  background: '#fff',
};

function cellStyle(head: boolean): React.CSSProperties {
  return {
    border: '1px solid #d7d7ca',
    padding: '6px 8px',
    textAlign: 'left',
    background: head ? '#f7f0bf' : '#fff',
    fontWeight: head ? 700 : 400,
  };
}

const quoteStyle: React.CSSProperties = {
  borderLeft: '3px solid #d0d0c0',
  margin: '8px 0',
  padding: '2px 0 2px 10px',
  color: '#555',
};

function mentionStyle({ actionable, currentUser }: { actionable: boolean; currentUser: boolean }): React.CSSProperties {
  return {
    display: 'inline-block',
    border: currentUser ? '1px solid #0b63ce' : '1px solid #c9a400',
    background: currentUser ? '#dbeafe' : '#fff3a3',
    color: '#111',
    padding: '0 5px',
    borderRadius: 4,
    fontWeight: 700,
    lineHeight: 1.5,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: actionable ? 'pointer' : 'default',
  };
}
