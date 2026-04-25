import { useState } from 'react';
import type React from 'react';
import type { Agent, GoalAlignment, Task } from '../api.js';
import { confirmGoalAlignment, patchGoalAlignment } from '../api.js';

type Props = {
  alignment: GoalAlignment;
  agents: Agent[];
  onClose: () => void;
  onAlignmentUpdated: (alignment: GoalAlignment) => void;
  onTasksCreated: (tasks: Task[]) => void;
};

export function GoalAlignmentPanel({ alignment, agents, onClose, onAlignmentUpdated, onTasksCreated }: Props) {
  const [objective, setObjective] = useState(alignment.objective);
  const [answers, setAnswers] = useState(alignment.answers.join('\n'));
  const [successCriteria, setSuccessCriteria] = useState(alignment.successCriteria.join('\n'));
  const [error, setError] = useState('');

  const saveRevision = async () => {
    setError('');
    try {
      onAlignmentUpdated(await patchGoalAlignment(alignment.id, {
        objective: objective.trim(),
        answers: splitLines(answers),
        successCriteria: splitLines(successCriteria),
        status: 'awaiting_confirmation',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirm = async () => {
    setError('');
    try {
      const result = await confirmGoalAlignment(alignment.id, { requesterName: 'user' });
      onAlignmentUpdated(result.alignment);
      onTasksCreated(result.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside style={{
      width: 420,
      maxWidth: '46vw',
      borderLeft: '2px solid #000',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Courier New', monospace",
      minHeight: 0,
    }}>
      <div style={{ minHeight: 48, borderBottom: '2px solid #000', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
        <strong style={{ flex: 1, fontSize: 14 }}>GOAL ALIGNMENT</strong>
        <Badge text={alignment.riskLevel.toUpperCase()} tone={alignment.riskLevel === 'high' ? '#ffb4c8' : alignment.riskLevel === 'medium' ? '#fff0a8' : '#c8ffd7'} />
        <Badge text={alignment.status.replace(/_/g, ' ').toUpperCase()} tone="#FFD700" />
        <button type="button" onClick={onClose} style={buttonStyle('#fff', '#000')}>CLOSE</button>
      </div>
      <div style={{ padding: 12, overflow: 'auto', display: 'grid', gap: 10 }}>
        <Field label="Objective" value={objective} onChange={setObjective} rows={4} />
        {alignment.questions.length > 0 ? (
          <section style={sectionStyle}>
            <strong style={sectionTitleStyle}>CLARIFYING QUESTIONS</strong>
            {alignment.questions.map((question) => <div key={question} style={{ fontSize: 12 }}>- {question}</div>)}
          </section>
        ) : null}
        <Field label="Answers / context" value={answers} onChange={setAnswers} rows={4} placeholder="One answer per line" />
        <Field label="Success criteria" value={successCriteria} onChange={setSuccessCriteria} rows={4} placeholder="One criterion per line" />
        <section style={sectionStyle}>
          <strong style={sectionTitleStyle}>PLAN PREVIEW</strong>
          <div style={{ fontSize: 12, lineHeight: 1.45 }}>{alignment.planSummary}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {alignment.taskDrafts.map((task) => (
              <div key={`${task.role}-${task.title}`} style={{ border: '1px solid #000', padding: 7, background: '#fbfbf7' }}>
                <strong style={{ fontSize: 12 }}>{task.role?.toUpperCase() ?? 'TASK'}: {task.title}</strong>
                <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>Assignee: {agentLabel(task.assigneeId, agents)}</div>
              </div>
            ))}
          </div>
        </section>
        <section style={sectionStyle}>
          <strong style={sectionTitleStyle}>RECOMMENDED AGENTS</strong>
          {[...alignment.recommendedAgentIds, ...alignment.reviewerAgentIds].map((agentId) => (
            <div key={agentId} style={{ fontSize: 12 }}>
              <strong>{agentLabel(agentId, agents)}</strong>
              <div style={{ color: '#555' }}>{alignment.recommendationReasons[agentId] ?? 'Recommended by role/capability match.'}</div>
            </div>
          ))}
          {alignment.gaps.map((gap) => <div key={gap} style={{ fontSize: 12, color: '#9f1239' }}>Gap: {gap}</div>)}
        </section>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={saveRevision} style={buttonStyle('#fff', '#000')}>REVISE</button>
          <button type="button" onClick={confirm} style={buttonStyle('#FFD700', '#000')}>CONFIRM PLAN</button>
        </div>
        {error ? <div style={{ border: '2px solid #000', background: '#fff0f4', color: '#b00020', padding: 8, fontSize: 12, fontWeight: 700 }}>{error}</div> : null}
      </div>
    </aside>
  );
}

function Badge({ text, tone }: { text: string; tone: string }) {
  return <span style={{ fontSize: 10, border: '1.5px solid #000', padding: '2px 5px', background: tone }}>{text}</span>;
}

function Field({ label, value, onChange, rows, placeholder }: { label: string; value: string; onChange: (value: string) => void; rows: number; placeholder?: string }) {
  return (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 700 }}>{label.toUpperCase()}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} style={{ ...inputStyle, minHeight: rows * 24, resize: 'vertical' }} />
    </label>
  );
}

function splitLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function agentLabel(agentId: string | undefined, agents: Agent[]): string {
  if (!agentId) return 'Unassigned';
  const agent = agents.find((candidate) => candidate.id === agentId);
  return agent ? `${agent.displayName ?? agent.name} (${agent.name})` : agentId;
}

const sectionStyle: React.CSSProperties = {
  border: '2px solid #000',
  background: '#fff',
  padding: 9,
  display: 'grid',
  gap: 7,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
};

const inputStyle: React.CSSProperties = {
  border: '2px solid #000',
  background: '#fff',
  color: '#000',
  fontFamily: "'Courier New', monospace",
  fontSize: 13,
  padding: 8,
  width: '100%',
};

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    border: '2px solid #000',
    background,
    color,
    fontFamily: "'Courier New', monospace",
    fontSize: 11,
    fontWeight: 700,
    padding: '7px 9px',
    cursor: 'pointer',
    boxShadow: '2px 2px 0 #000',
  };
}
