const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

const SERVER = process.env.MOCK_SERVER_URL || 'http://localhost:4001';

async function postEvent(ev) {
  const res = await fetch(`${SERVER}/api/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ev),
  });
  return res.json();
}

async function simulateLifecycle() {
  const actionId = 'act_' + uuidv4().slice(0,8);
  const swarmId = 'sw_demo';
  const base = {
    action_id: actionId,
    agent_id: 'daemon_sim',
    timestamp: new Date().toISOString(),
  };

  console.log('Posting waiting_lock');
  await postEvent({ ...base, status: 'waiting_lock', lock_owner: 'other_agent' });
  await new Promise(r => setTimeout(r, 1500));

  console.log('Posting awaiting_approval');
  await postEvent({ ...base, status: 'awaiting_approval', approval_id: 'ap_' + uuidv4().slice(0,8) });
  await new Promise(r => setTimeout(r, 1500));

  console.log('Posting running');
  await postEvent({ ...base, status: 'running' });
  await new Promise(r => setTimeout(r, 800));

  console.log('Posting success');
  await postEvent({ ...base, status: 'success', stdout: 'ok', stderr: '' });
}

simulateLifecycle().catch(e => { console.error(e); process.exit(1); });
