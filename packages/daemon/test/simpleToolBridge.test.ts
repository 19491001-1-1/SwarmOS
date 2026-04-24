import { describe, it, expect } from 'vitest';
import { parseBridgeLine, BRIDGE_MARKER } from '../src/bridge/simpleToolBridge.js';

describe('parseBridgeLine', () => {
  it('extracts content from valid line', () => {
    const line = `${BRIDGE_MARKER} {"content":"Hello world"}`;
    const result = parseBridgeLine(line);
    expect(result).not.toBeNull();
    expect(result?.content).toBe('Hello world');
  });

  it('ignores normal log lines', () => {
    expect(parseBridgeLine('Just some log output')).toBeNull();
    expect(parseBridgeLine('Processing request...')).toBeNull();
    expect(parseBridgeLine('')).toBeNull();
  });

  it('returns null for invalid JSON after marker', () => {
    const line = `${BRIDGE_MARKER} not-json`;
    expect(parseBridgeLine(line)).toBeNull();
  });

  it('returns null when content field is missing', () => {
    const line = `${BRIDGE_MARKER} {"other":"field"}`;
    expect(parseBridgeLine(line)).toBeNull();
  });

  it('handles marker with preceding text', () => {
    const line = `some prefix ${BRIDGE_MARKER} {"content":"reply"}`;
    const result = parseBridgeLine(line);
    expect(result?.content).toBe('reply');
  });
});
