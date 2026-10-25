// Runs `tick` repeatedly, waiting `intervalMs` after each run finishes, so runs never overlap
// (a full snapshot can take longer than the interval on the rate-limited public RPC).
export function startPolling(tick: () => Promise<unknown>, intervalMs: number) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loop = async () => {
    if (stopped) return;
    try { await tick(); } catch { /* tick is responsible for logging its own errors */ }
    if (!stopped) timer = setTimeout(loop, intervalMs);
  };
  void loop();
  return () => { stopped = true; clearTimeout(timer); };
}
