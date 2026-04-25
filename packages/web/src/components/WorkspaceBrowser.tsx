import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceEntry, WorkspaceFile } from '../api.js';
import { getAgentWorkspace } from '../api.js';

type Props = {
  agentId: string;
};

const FONT = "'Courier New', monospace";

export function WorkspaceBrowser({ agentId }: Props) {
  const [currentPath, setCurrentPath] = useState('');
  const [entry, setEntry] = useState<WorkspaceEntry | undefined>();
  const [selectedFile, setSelectedFile] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const crumbs = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/').filter(Boolean);
  }, [currentPath]);

  const load = async (path = currentPath) => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await getAgentWorkspace(agentId, path);
      setEntry(data);
      setCurrentPath(data.path);
      if (data.type === 'file') setSelectedFile(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WORKSPACE LOAD FAILED');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPath('');
    setSelectedFile('');
    setEntry(undefined);
    load('');
  }, [agentId]);

  const openChild = (child: WorkspaceFile) => {
    const next = joinPath(currentPath, child.name);
    if (child.type === 'dir') {
      setSelectedFile('');
      load(next);
    } else {
      load(next);
    }
  };

  const goToCrumb = (index: number) => {
    const next = crumbs.slice(0, index + 1).join('/');
    setSelectedFile('');
    load(next);
  };

  const goUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setSelectedFile('');
    load(parts.join('/'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      <div style={{ border: '2px solid #000', background: '#fff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', borderBottom: '2px solid #000' }}>
          <div style={{ padding: 8, minWidth: 0, fontSize: 10, fontWeight: 700, overflowWrap: 'anywhere' }}>
            ~/.xoxiang/agents/{agentId}/{currentPath}
          </div>
          <button onClick={() => load(currentPath)} disabled={loading} style={buttonStyle('#FFD700', '#000')}>
            {loading ? '...' : 'REFRESH'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: 8 }}>
          <button onClick={() => load('')} style={crumbStyle(!currentPath)}>ROOT</button>
          {crumbs.map((crumb, index) => (
            <button key={`${crumb}-${index}`} onClick={() => goToCrumb(index)} style={crumbStyle(index === crumbs.length - 1)}>
              {crumb}
            </button>
          ))}
        </div>
      </div>

      {error ? <div style={{ border: '2px solid #000', background: '#fff', color: '#b00020', fontWeight: 700, fontSize: 11, padding: 8 }}>{error}</div> : null}

      <div style={{ display: 'grid', gridTemplateRows: 'minmax(150px, auto) minmax(220px, 1fr)', gap: 8 }}>
        <div style={{ border: '2px solid #000', background: '#fff', minHeight: 150, maxHeight: 230, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', borderBottom: '2px solid #000', background: '#fafaf5' }}>
            <div style={{ padding: 8, fontSize: 10, fontWeight: 700 }}>FILES</div>
            <button onClick={goUp} disabled={!currentPath} style={buttonStyle('#fff', '#000')}>UP</button>
          </div>
          {entry?.type === 'dir' && entry.children.length === 0 ? <Empty label="[ EMPTY ]" /> : null}
          {entry?.type === 'dir' ? entry.children.map((child) => (
            <button key={`${child.type}:${child.name}`} onClick={() => openChild(child)} style={fileRowStyle(selectedFile === joinPath(currentPath, child.name))}>
              <span style={{ fontWeight: 700 }}>{child.type === 'dir' ? '[DIR]' : '[FILE]'}</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.name}</span>
              <span style={{ color: '#666', fontSize: 10 }}>{child.type === 'file' && child.size !== undefined ? formatBytes(child.size) : ''}</span>
            </button>
          )) : null}
          {entry?.type === 'file' ? <Empty label="[ SELECT A DIRECTORY TO BROWSE ]" /> : null}
        </div>

        <div style={{ border: '2px solid #000', background: '#fff', minHeight: 220, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 8, borderBottom: '2px solid #000', fontSize: 10, fontWeight: 700, background: '#fafaf5', overflowWrap: 'anywhere' }}>
            {entry?.type === 'file' ? entry.path : 'Select a file to view'}
          </div>
          {entry?.type === 'file' ? (
            <>
              {entry.binary ? <div style={{ padding: 8, borderBottom: '2px solid #000', background: '#FFD700', fontSize: 10, fontWeight: 700 }}>BINARY FILE PREVIEW DISABLED</div> : null}
              {entry.truncated ? <div style={{ padding: 8, borderBottom: '2px solid #000', background: '#FFD700', fontSize: 10, fontWeight: 700 }}>TRUNCATED TO 1MB</div> : null}
              <pre style={{ margin: 0, padding: 10, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: FONT, fontSize: 11, lineHeight: 1.45 }}>
                {entry.content}
              </pre>
            </>
          ) : (
            <Empty label="[ SELECT A FILE TO VIEW ]" />
          )}
        </div>
      </div>
    </div>
  );
}

function joinPath(base: string, name: string): string {
  return [base, name].filter(Boolean).join('/');
}

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    border: 'none',
    borderLeft: '2px solid #000',
    background,
    color,
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 10,
    padding: '7px 8px',
    cursor: 'pointer',
  };
}

function crumbStyle(active: boolean): React.CSSProperties {
  return {
    border: '2px solid #000',
    background: active ? '#FFD700' : '#fff',
    color: '#000',
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 10,
    padding: '4px 7px',
    cursor: 'pointer',
  };
}

function fileRowStyle(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '54px minmax(0, 1fr) 58px',
    gap: 6,
    alignItems: 'center',
    border: 'none',
    borderBottom: '2px solid #000',
    background: active ? '#FFD700' : '#fff',
    color: '#000',
    fontFamily: FONT,
    fontSize: 11,
    padding: '8px',
    cursor: 'pointer',
    textAlign: 'left',
  };
}

function Empty({ label }: { label: string }) {
  return (
    <div style={{ padding: 16, textAlign: 'center', color: '#777', fontSize: 11 }}>
      {label}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}
