#!/usr/bin/env tsx
// Fake CLI that echoes the last argument as a message via the bridge protocol

const args = process.argv.slice(2);
const lastArg = args[args.length - 1] ?? '';

// Extract the last user message from transcript
const lines = lastArg.split('\n').filter(Boolean);
let userMessage = 'Hello';
for (let i = lines.length - 1; i >= 0; i--) {
  const match = lines[i].match(/^\[.*?\] \S+: (.+)$/);
  if (match) {
    userMessage = match[1];
    break;
  }
}

process.stdout.write(`[[MINI_SLOCK_SEND_MESSAGE]] {"content":"Echo: ${userMessage}"}\n`);
process.exit(0);
