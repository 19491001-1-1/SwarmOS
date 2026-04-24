import { describe, expect, it } from 'vitest';
import { toAgentDelivery } from '../src/message.js';

describe('toAgentDelivery', () => {
  it('maps a stored message and channel to daemon delivery format', () => {
    expect(
      toAgentDelivery(
        {
          id: 'msg-1',
          channelId: 'general',
          senderName: 'user',
          content: 'hello',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'general',
          name: 'general',
          createdAt: '2026-01-01T00:00:00.000Z',
        }
      )
    ).toEqual({
      id: 'msg-1',
      channelId: 'general',
      channelName: 'general',
      senderName: 'user',
      content: 'hello',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
