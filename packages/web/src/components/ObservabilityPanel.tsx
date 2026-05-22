import type { Agent, AgentActivity, ApprovalRecord, LockEvent } from '../api.js';
import { decideApproval } from '../api.js';

type Props = {
  agents: Agent[];
  activitiesByAgent: Record<string, AgentActivity[]>;
  approvals: ApprovalRecord[];
  lockEvents: LockEvent[];
  onApprovalsUpdated: (approvals: ApprovalRecord[]) => void;
  onOpenAgent: (agentId: string) => void;
  onClose?: () => void;
};

export function ObservabilityPanel({ agents, activitiesByAgent, approvals, lockEvents = [], onApprovalsUpdated, onOpenAgent, onClose }: Props) {
  const thoughtStream = Object.values(activitiesByAgent)
    .flatMap((items) => items)
    .filter((activity) => activity.type === 'thinking' || activity.type === 'working' || activity.type === 'output')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 14);

  // Build action timeline from all activity types
  const timeline = [
    ...approvals.map((approval) => ({
      id: `approval:${approval.id}`,
      time: approval.decidedAt ?? approval.createdAt,
      title: approval.status === 'pending' ? 'awaiting_approval' : approval.status,
      detail: approval.reason ?? approval.actionId ?? approval.agentId ?? 'approval event',
      kind: approval.status,
    })),
    ...lockEvents.map((lock) => ({
      id: `lock:${lock.path}:${lock.since ?? Date.now()}`,
      time: lock.since ?? new Date().toISOString(),
      title: lock.type === 'locked' ? 'waiting_lock' : 'lock_released',
      detail: `${lock.path} by ${lock.agentId}`,
      kind: lock.type,
    })),
    ...thoughtStream.map((activity) => ({
      id: `activity:${activity.id}`,
      time: activity.createdAt,
      title: activity.type,
      detail: activity.detail ?? 'activity event',
      kind: activity.type,
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 18);

  // Categorize lock events for the dedicated section
  const activeLocks = lockEvents.filter((lock) => lock.type === 'locked');
  const recentLockReleases = lockEvents.filter((lock) => lock.type === 'released');
  // const currentLockPaths = new Set(activeLocks.map((l) => l.path));

  const handleDecision = async (approvalId: string, approved: boolean) => {
    const updated = await decideApproval(approvalId, approved, 'user');
    onApprovalsUpdated(approvals.map((approval) => (approval.id === updated.id ? updated : approval)));
  };

  return (
    <div className="right-panel right-panel-observability observability-panel">
      <div className="observability-header">
        <span className="observability-header-title">▶ OBSERVABILITY</span>
        <div className="observability-header-actions">
          {onClose ? (
            <button type="button" onClick={onClose} className="observability-rail-button">X</button>
          ) : null}
        </div>
      </div>

      <div className="observability-content">
        {/* Section: Active File Locks */}
        <section className="observability-card">
          <SectionTitle title="ACTIVE FILE LOCKS" subtitle="exclusive write locks held by agents" />
          <div className="observability-feed">
            {activeLocks.length === 0 ? (
              <EmptyState label="NO ACTIVE LOCKS" />
            ) : (
              activeLocks.slice(0, 10).map((lock, idx) => (
                <div key={`lock:${lock.path}:${idx}`} className="observability-lock-row observability-lock-locked">
                  <div className="observability-row-head">
                    <strong className="observability-row-title observability-row-title-waiting">LOCKED</strong>
                    <span className="observability-row-time">{lock.since ? formatTime(lock.since) : ''}</span>
                  </div>
                  <div className="observability-row-subbody">
                    <span>Path: <code className="observability-code">{lock.path}</code></span>
                    <span>Owner: {resolveAgentName(lock.agentId, agents)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Section: Recent Lock Releases */}
        {recentLockReleases.length > 0 ? (
          <section className="observability-card">
            <SectionTitle title="RECENT LOCK RELEASES" subtitle={`${recentLockReleases.length} total`} />
            <div className="observability-feed">
              {recentLockReleases.slice(0, 6).map((lock, idx) => (
                <div key={`release:${lock.path}:${idx}`} className="observability-lock-row observability-lock-released">
                  <div className="observability-row-head">
                    <strong className="observability-row-title observability-row-title-success">RELEASED</strong>
                    <span className="observability-row-time">{lock.since ? formatTime(lock.since) : ''}</span>
                  </div>
                  <div className="observability-row-subbody">
                    <span>Path: <code className="observability-code">{lock.path}</code></span>
                    <span>Owner: {resolveAgentName(lock.agentId, agents)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Section: Thought Stream */}
        <section className="observability-card">
          <SectionTitle title="THOUGHT STREAM" subtitle="separate from normal chat messages" />
          <div className="observability-feed">
            {thoughtStream.length === 0 ? <EmptyState label="NO THOUGHT EVENTS" /> : thoughtStream.map((activity) => <ThoughtRow key={activity.id} activity={activity} agents={agents} onOpenAgent={onOpenAgent} />)}
          </div>
        </section>

        {/* Section: Approval Cards */}
        <section className="observability-card">
          <SectionTitle title="APPROVAL CARDS" subtitle="approve / reject pending work" />
          <div className="observability-feed">
            {approvals.length === 0 ? <EmptyState label="NO APPROVALS YET" /> : approvals.map((approval) => (
              <div key={approval.id} className={`observability-approval-row observability-approval-row-${approval.status}`}>
                <div className="observability-timeline-head">
                  <strong className="observability-row-title">{approval.status === 'pending' ? 'awaiting_approval' : approval.status}</strong>
                  <span className="observability-row-time">{formatTime(approval.decidedAt ?? approval.createdAt)}</span>
                </div>
                <div className="observability-approval-meta">
                  <div>{approval.reason ?? 'No reason provided'}</div>
                  {approval.agentId ? (
                    <div className="observability-agent-line">
                      <span>Agent: {resolveAgentName(approval.agentId, agents)}</span>
                      <button type="button" className="observability-link-button" onClick={() => onOpenAgent(approval.agentId!)}>OPEN</button>
                    </div>
                  ) : null}
                  {approval.actionId ? <div>Action: {approval.actionId}</div> : null}
                  {approval.riskLevel ? <div>Risk: {approval.riskLevel.toUpperCase()}</div> : null}
                </div>
                {approval.status === 'pending' ? (
                  <div className="observability-button-row">
                    <button type="button" onClick={() => void handleDecision(approval.id, true)} className="observability-action-button observability-action-button-approve">APPROVE</button>
                    <button type="button" onClick={() => void handleDecision(approval.id, false)} className="observability-action-button observability-action-button-reject">REJECT</button>
                  </div>
                ) : (
                  <div className="observability-approval-status">
                    {approval.reviewer ? `Reviewer: ${approval.reviewer}` : 'Decision recorded'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Section: Action Timeline */}
        <section className="observability-card">
          <SectionTitle title="ACTION TIMELINE" subtitle="waiting_lock / awaiting_approval / timed_out / success" />
          <div className="observability-feed">
            {timeline.length === 0 ? <EmptyState label="NO ACTION STATE CHANGES" /> : timeline.map((item) => (
              <div key={item.id} className="observability-timeline-row">
                <div className="observability-row-head">
                  <strong className={`observability-row-title observability-row-title-${statusClass(item.kind)}`}>{item.title}</strong>
                  <span className="observability-row-time">{formatTime(item.time)}</span>
                </div>
                <div className="observability-row-subbody">{item.detail}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function statusClass(kind: string): string {
  if (kind === 'locked' || kind === 'waiting_lock' || kind === 'risk_detected' || kind === 'awaiting_approval' || kind === 'pending') return 'waiting';
  if (kind === 'released' || kind === 'approved' || kind === 'success' || kind === 'output') return 'success';
  if (kind === 'rejected' || kind === 'error' || kind === 'timed_out' || kind === 'cancelled') return 'error';
  return 'info';
}

function resolveAgentName(agentId: string, agents: Agent[]): string {
  const agent = agents.find((a) => a.id === agentId);
  return agent?.displayName ?? agent?.name ?? agentId;
}

function ThoughtRow({ activity, agents, onOpenAgent }: { activity: AgentActivity; agents: Agent[]; onOpenAgent: (agentId: string) => void }) {
  const agent = agents.find((candidate) => candidate.id === activity.agentId);
  return (
    <div className="observability-thought-row">
      <div className="observability-row-meta">
        <strong>{agent?.displayName ?? agent?.name ?? activity.agentId}</strong>
        {agent ? <button type="button" className="observability-link-button" onClick={() => onOpenAgent(agent.id)}>OPEN</button> : null}
        <span>{activity.type.toUpperCase()}</span>
      </div>
      <div className="observability-thought-body">{activity.detail ?? 'thinking...'}</div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="observability-section-title">
      <div className="observability-section-title-main">{title}</div>
      <div className="observability-section-title-sub">{subtitle}</div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="observability-empty">{label}</div>;
}

function formatTime(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleTimeString();
}
