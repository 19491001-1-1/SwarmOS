# Bugfix: Chat Scroll Restoration

## Context

The v0.9 chat UI keeps one `messages` array for the currently selected channel. When the user switches channels, `selectedChannel` changes immediately but the new channel messages arrive asynchronously.

This makes the UI briefly render:

- the new channel header
- the previous channel's message DOM
- a scroll restoration attempt against that stale DOM

After the API response arrives, the message DOM is replaced and the scroll state can jump again.

## CDP Observation

Local instance:

- web: `http://localhost:5173/`
- Chrome CDP: `127.0.0.1:9223`

Observed through `Runtime.evaluate`:

- The message scroll container is the center pane `div` with `overflowY: auto`.
- With two seeded long channels, restoring works only when waiting for the channel's real message list to finish rendering before switching again.
- The fragile part is the transition state: `ChannelView` receives the new `channelId` while still receiving the old `messages` prop.
- `useLayoutEffect` currently treats that stale render as the channel switch moment and updates `lastChannelId`, `lastMessageCount`, `showJumpToLatest`, and `scrollTop` too early.

## User-Visible Problems

1. Switching chat windows can flash old content under the new channel title.
2. Scroll restoration can happen before the new channel's content height exists.
3. A slow response from a previously selected channel can overwrite the currently selected channel's messages.
4. The jump-to-latest affordance can appear based on stale content.
5. Search/thread targeted scrolling depends on the same unstable render timing.

## Fix Plan

### 1. Cache messages by channel

Move from a single `messages` array to `messagesByChannel`.

Expected behavior:

- Switching channels immediately renders cached messages for that channel if available.
- If no cache exists, render an empty/loading state for that channel instead of previous channel messages.
- API responses update only their own channel cache.

### 2. Guard async responses

When `loadMessages(channelId)` resolves, store the result under `messagesByChannel[channelId]`.

It must not blindly replace the currently visible message list.

### 3. Restore scroll after real channel content is rendered

Track channel transitions explicitly:

- save previous channel scroll position before changing channel
- restore the next channel position after the message list for that channel is rendered
- only auto-stick to bottom when the user was already near bottom in that same channel

### 4. Make jump-to-latest channel-scoped

Keep near-bottom and jump button state per channel, not as a single global boolean.

The button should also appear when the user manually scrolls away from the
bottom, not only when new messages arrive.

### 5. Preserve targeted scroll behavior

Search result and thread target scrolling should run after the destination message is present in the destination channel/thread DOM.

### 6. Verification

Run:

```bash
pnpm --filter @crewden/web typecheck
pnpm --filter @crewden/web test
pnpm verify
```

Manual CDP verification:

1. Seed two long channels.
2. Scroll channel A to a middle position.
3. Switch to channel B and scroll to a different position.
4. Switch back to A. It should restore A's position without flashing B content.
5. Switch back to B. It should restore B's position.
6. Search result navigation should land on the target message without being pulled to the bottom.

## Verification Result

After the fix, CDP sampling showed:

- channel `scroll-a` restored to `scrollTop: 1200`
- channel `scroll-b` restored to `scrollTop: 2200`
- `Jump to latest` appears when the user manually scrolls away from the bottom
- each channel rendered its own cached messages after switching, rather than relying on a single global message list
