import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PresenceAvatar } from '../src/components/PresenceAvatar.js';

describe('PresenceAvatar', () => {
  it('treats latest working activity as active even when status is idle', () => {
    render(
      <PresenceAvatar
        name="Claude"
        isAgent
        status="idle"
        latestActivity={{
          id: 'activity-1',
          agentId: 'agent-1',
          type: 'working',
          detail: 'tool:read',
          createdAt: '2026-04-25T00:00:00.000Z',
        }}
      />,
    );

    const avatar = screen.getByTitle('Working');
    expect(avatar).toHaveClass('presence-avatar-active');
  });
});
