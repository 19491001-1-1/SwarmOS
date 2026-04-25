import { useState } from 'react';
import type React from 'react';
import type { Agent, GoalBrief, Task } from '../api.js';
import { createGoalTasks, patchGoal } from '../api.js';

type Props = {
  goal: GoalBrief;
  agents: Agent[];
  onClose: () => void;
  onGoalUpdated: (goal: GoalBrief) => void;
  onTasksCreated: (tasks: Task[]) => void;
};

export function GoalDraftPanel({ goal, agents, onClose, onGoalUpdated, onTasksCreated }: Props) {
  const [objective, setObjective] = useState(goal.objective);
  const [successCriteria, setSuccessCriteria] = useState(goal.successCriteria.join('\n'));
  const [constraints, setConstraints] = useState(goal.constraints.join('\n'));
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [error, setError] = useState('');

  const confirmGoal = async () => {
    setError('');
    try {
      const updated = await patchGoal(goal.id, {
        objective: objective.trim(),
        successCriteria: splitLines(successCriteria),
        constraints: splitLines(constraints),
        status: 'confirmed',
      });
      onGoalUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createTask = async () => {
    const title = taskTitle.trim();
    if (!title) return;
    setError('');
    try {
      const result = await createGoalTasks(goal.id, {
        creatorName: 'user',
        tasks: [{
          title,
          assigneeId: taskAssignee || undefined,
          acceptanceCriteria: splitLines(successCriteria),
        }],
      });
      onTasksCreated(result.tasks);
      setTaskTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside style={{
      width: 380,
      maxWidth: '42vw',
      borderLeft: '2px solid #000',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Courier New', monospace",
      minHeight: 0,
    }}>
      <div style={{ minHeight: 48, borderBottom: '2px solid #000', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
        <strong style={{ flex: 1, fontSize: 14 }}>GOAL BRIEF</strong>
        <span style={{ fontSize: 10, border: '1.5px solid #000', padding: '2px 5px', background: goal.status === 'confirmed' ? '#86efac' : '#FFD700' }}>
          {goal.status.toUpperCase()}
        </span>
        <button type="button" onClick={onClose} style={buttonStyle('#fff', '#000')}>CLOSE</button>
      </div>
      <div style={{ padding: 12, overflow: 'auto', display: 'grid', gap: 10 }}>
        <Field label="Objective" value={objective} onChange={setObjective} rows={4} />
        <Field label="Success criteria" value={successCriteria} onChange={setSuccessCriteria} rows={5} placeholder="One criterion per line" />
        <Field label="Constraints" value={constraints} onChange={setConstraints} rows={3} placeholder="One constraint per line" />
        <button type="button" onClick={confirmGoal} style={buttonStyle('#FFD700', '#000')}>CONFIRM GOAL</button>

        <div style={{ borderTop: '2px solid #000', paddingTop: 10, display: 'grid', gap: 8 }}>
          <strong style={{ fontSize: 12 }}>Create task from this goal</strong>
          <input
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') createTask(); }}
            placeholder="Task title"
            style={inputStyle}
          />
          <select value={taskAssignee} onChange={(event) => setTaskAssignee(event.target.value)} style={inputStyle}>
            <option value="">Unassigned</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName ?? agent.name}</option>)}
          </select>
          <button type="button" onClick={createTask} style={buttonStyle('#FF4D8D', '#fff')}>CREATE TASK</button>
        </div>
        {error ? <div style={{ border: '2px solid #000', background: '#fff0f4', color: '#b00020', padding: 8, fontSize: 12, fontWeight: 700 }}>{error}</div> : null}
      </div>
    </aside>
  );
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
