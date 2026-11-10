// Input-only transport. Never computes a position. New steering does not wait
// for a previous RTT; retries resend only the freshest full intent, with the
// SAME sequence. Reset/identity guards prevent old-room completions or retries.
export interface SteeringState { dir: number; cartHeld: boolean; interactHeld: boolean }
interface Identity { code: string; playerId: string; base: string }
interface Options {
  identity: () => Identity | null;
  rtt: (ms: number) => void;
  error: (text: string) => void;
  failed: () => void;
  ack?: (data: Record<string, unknown>) => void;
  initialSeq?: () => number;
  fetcher?: typeof fetch;
}
export class InputTransport {
  private sequence = 0;
  private epoch = 0;
  private newestSteer = 0;
  private state: SteeringState = { dir: 0, cartHeld: false, interactHeld: false };
  private pending = new Map<number, AbortController>();
  constructor(private options: Options) {
    this.sequence = options.initialSeq?.() ?? 0;
  }
  get lastSequence(): number { return this.sequence; }
  reset() {
    this.epoch++; this.sequence = this.options.initialSeq?.() ?? 0; this.newestSteer = 0;
    this.state = { dir: 0, cartHeld: false, interactHeld: false };
    for (const ctl of this.pending.values()) ctl.abort();
    this.pending.clear();
  }
  resume(accepted: number) {
    if (Number.isSafeInteger(accepted) && accepted >= 0) this.sequence = Math.max(this.sequence, accepted);
  }
  steer(state: SteeringState): Promise<void> {
    this.state = { ...state };
    const seq = ++this.sequence;
    this.newestSteer = seq;
    return this.request({ ...this.state, seq }, true);
  }
  send(payload: Record<string, unknown>): Promise<void> {
    if (typeof payload.interactHeld === "boolean") this.state.interactHeld = payload.interactHeld;
    const seq = ++this.sequence;
    return this.request({ ...this.state, ...payload, seq }, false);
  }
  private async request(payload: Record<string, unknown>, steering: boolean) {
    const identity = this.options.identity();
    if (!identity) return;
    const epoch = this.epoch;
    const seq = payload.seq as number;
    const body = JSON.stringify({ ...identity, ...payload, base: undefined });
    const current = () => epoch === this.epoch && this.options.identity()?.code === identity.code && this.options.identity()?.base === identity.base;
    for (let attempt = 0; attempt < (steering ? 4 : 1); attempt++) {
      if (!current() || (steering && seq !== this.newestSteer)) return;
      const ctl = new AbortController();
      // Preserve headroom for STOP/reverse, even on HTTP/1.1's six-connection pool.
      if (steering && this.pending.size >= 3) {
        const old = this.pending.entries().next().value;
        if (old) { old[1].abort(); this.pending.delete(old[0]); }
      }
      this.pending.set(seq, ctl);
      const timer = setTimeout(() => ctl.abort(), 1500);
      const started = performance.now();
      let retry = false;
      try {
        const res = await (this.options.fetcher ?? fetch)(identity.base + "/api/game/input", {
          method: "POST", headers: { "content-type": "application/json" }, body,
          signal: ctl.signal, keepalive: true, cache: "no-store",
        });
        // Consume every body: ignoring successful bodies can strand a connection.
        const text = await res.text();
        if (!current()) return;
        this.options.rtt(performance.now() - started);
        if (res.ok) {
          try {
            const data = JSON.parse(text);
            if (data && data.ok) this.options.ack?.(data);
          } catch { /* ignore non-JSON ok bodies */ }
          return;
        }
        if (steering && (res.status === 429 || res.status >= 500)) retry = true;
        else {
          let message = "The input could not be delivered.";
          try { message = JSON.parse(text).error ?? message; } catch { /* plain proxy error */ }
          this.options.error(message);
          return;
        }
      } catch {
        if (!current() || (steering && seq !== this.newestSteer)) return;
        retry = steering;
      } finally {
        clearTimeout(timer); this.pending.delete(seq);
      }
      if (!retry) { if (current()) this.options.failed(); return; }
      if (attempt === 3) { this.options.failed(); this.options.error("Connection interrupted. Release movement and try again."); return; }
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}
