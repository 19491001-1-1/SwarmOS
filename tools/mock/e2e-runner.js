#!/usr/bin/env node
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const WebSocket = require('ws');
const path = require('path');

const ROOT = path.resolve(__dirname);
const MOCK_SERVER_URL = process.env.MOCK_SERVER_URL || 'http://localhost:4001';
const MOCK_WS_URL = (MOCK_SERVER_URL.replace(/^http/, 'ws')) + '/ws';
const CREWDEN_SERVER = process.env.CREWDEN_SERVER || 'http://localhost:3000';

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function isAlive(url) {
  try {
    const res = await fetch(url, { method: 'GET', timeout: 2000 });
    return res.status < 500;
  } catch (e) { return false; }
}

async function ensureMockServer() {
  // try connect to ws first
  for (let i=0;i<3;i++) {
    try {
      await fetch(MOCK_SERVER_URL + '/api/v1/events', { method: 'POST', body: JSON.stringify({ test: 'ping' }), headers: { 'content-type': 'application/json' } });
      return null; // server up
    } catch (e) { }
    // try to spawn
    console.log('Starting mock-server...');
    const proc = spawn(process.execPath, [path.join(ROOT, '..','mock-server','index.js')], { cwd: path.join(ROOT,'..','mock-server'), stdio: ['ignore','inherit','inherit'], env: process.env });
    await wait(1000);
    // check
    if (await isAlive(MOCK_SERVER_URL + '/api/v1/events')) return proc;
    // else continue loop
  }
  return null;
}

async function run() {
  const spawned = [];

  const mockProc = await ensureMockServer();
  if (mockProc) spawned.push(mockProc);

  console.log('Connecting to mock websocket at', MOCK_WS_URL);
  const ws = new WebSocket(MOCK_WS_URL);
  const messages = [];
  let ready = false;
  ws.on('open', () => { ready = true; console.log('ws open'); });
  ws.on('message', (m) => {
    try { messages.push(JSON.parse(m.toString())); } catch (e) { messages.push(m.toString()); }
    console.log('recv:', m.toString());
  });

  // wait for websocket ready
  for (let i=0;i<20;i++) { if (ready) break; await wait(200); }
  if (!ready) console.warn('Websocket not open; continuing but may not receive events');

  // trigger swarm/init on crewden server if available
  let usedMock = false;
  try {
    const resp = await fetch(`${CREWDEN_SERVER}/api/v1/swarm/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ protocol_version: 'v1.0.0', channel_id: 'c_e2e', agents: [{ agent_id: 'a1' }] }) });
    if (resp.status === 201) console.log('Triggered crewden server swarm/init'); else { console.warn('Crewden server returned', resp.status); }
  } catch (e) {
    console.warn('Crewden server not reachable, posting swarm:init directly to mock-server');
    usedMock = true;
    await fetch(MOCK_SERVER_URL + '/api/v1/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'swarm:init', swarm_id: 'sw_e2e', channel_id: 'c_e2e', agent_count: 1 }) });
  }

  // spawn mock-daemon to post action events to mock-server
  console.log('Starting mock-daemon to post lifecycle events');
  const daemonProc = spawn(process.execPath, [path.join(ROOT,'..','mock-daemon','index.js')], { cwd: path.join(ROOT,'..','mock-daemon'), env: Object.assign({ MOCK_SERVER_URL }, process.env), stdio: ['ignore','inherit','inherit'] });
  spawned.push(daemonProc);

  // spawn an exec-test to validate real command execution and timeout behavior
  console.log('Starting exec-test to validate spawn/timeout');
  const execTestCmd = process.platform === 'win32' ? 'timeout 5' : 'sleep 5';
  const execProc = spawn(process.execPath, [path.join(ROOT,'exec-test.js'), execTestCmd], { cwd: ROOT, env: Object.assign({ EXEC_TEST_TIMEOUT_MS: '2000', E2E_ALLOW_EXEC: 'true' }, process.env), stdio: ['ignore','inherit','inherit'] });
  spawned.push(execProc);

  // wait for expected events
  const expected = ['swarm:init','waiting_lock','awaiting_approval','running','success'];
  const seen = new Set();
  const start = Date.now();
  while (Date.now() - start < 30000) {
    for (const m of messages.slice()) {
      try {
        const t = typeof m === 'string' ? m : m.type ?? JSON.stringify(m);
        for (const e of expected) if (String(t).includes(e)) seen.add(e);
      } catch (e) {}
    }
    if (expected.every(e => seen.has(e))) break;
    await wait(300);
  }

  const allSeen = expected.every(e => seen.has(e));
  console.log('Expected events:', expected);
  console.log('Seen events:', Array.from(seen));

  // cleanup
  for (const p of spawned) {
    try { p.kill(); } catch (_) {}
  }
  try { ws.close(); } catch (_) {}

  if (allSeen) { console.log('E2E successful'); process.exit(0); }
  console.error('E2E failed: not all events observed'); process.exit(2);
}

run().catch(e => { console.error(e); process.exit(1); });
