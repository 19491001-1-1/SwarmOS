export async function runWithTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<{ ok: true; value: T } | { ok: false; timedOut: true }> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<{ ok: false; timedOut: true }>((resolve) => {
    timeoutHandle = setTimeout(() => {
      try { onTimeout?.(); } catch (_) {}
      resolve({ ok: false, timedOut: true });
    }, ms);
  });

  const res = await Promise.race([promise.then((v) => ({ ok: true as const, value: v })), timeoutPromise]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  return res as any;
}
