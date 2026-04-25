import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Mention } from '../api.js';

type Props = {
  content: string;
  mentions?: Mention[];
};

export function normalizeMessageContent(content: string): string {
  return content.replace(/\\n/g, '\n');
}

export function MessageContent({ content, mentions = [] }: Props) {
  const normalized = applyMentionLinks(normalizeMessageContent(content), mentions);
  return (
    <div style={contentStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('mention:')) {
              const [, type] = href.split(':');
              return <span style={mentionStyle(type === 'agent')}>{children}</span>;
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
  let result = content;
  for (const mention of mentions) {
    const token = `@${mention.label}`;
    const link = `[@${mention.label}](mention:${mention.type}:${mention.id})`;
    result = result.split(token).join(link);
  }
  if (!mentions.some((mention) => mention.type === 'user') && result.includes('@user')) {
    result = result.split('@user').join('[@user](mention:user:user)');
  }
  return result;
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

function mentionStyle(agent: boolean): React.CSSProperties {
  return {
    display: 'inline-block',
    border: '1px solid #c9a400',
    background: agent ? '#fff3a3' : '#f1f1e8',
    color: '#111',
    padding: '0 5px',
    borderRadius: 4,
    fontWeight: 700,
    lineHeight: 1.5,
  };
}
