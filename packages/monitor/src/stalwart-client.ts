/**
 * Thin Stalwart Mail Server management-API client. Endpoint paths intentionally
 * conservative — Stalwart's API surface evolves, so we only call a small set
 * and degrade gracefully when anything 404s. Callers can extend by using
 * `client.get(path)` directly.
 */

export interface StalwartClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

export interface StalwartSnapshotSummary {
  queueDepth: number | null;
  queueFailed: number | null;
  delivered24h: number | null;
  bounced24h: number | null;
  rejected24h: number | null;
  tlsPercent: number | null;
  raw: Record<string, unknown>;
  error: string | null;
}

export class StalwartClient {
  constructor(private opts: StalwartClientOptions) {}

  private url(path: string): string {
    const base = this.opts.baseUrl.replace(/\/$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async get<T = unknown>(path: string): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 8000);
    try {
      const res = await fetch(this.url(path), {
        headers: { Authorization: `Bearer ${this.opts.token}`, Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    } finally {
      clearTimeout(t);
    }
  }

  /** Best-effort: tries a couple of common Stalwart endpoints and folds whatever
   *  it finds into a summary. Missing fields stay null. */
  async fetchSnapshotSummary(): Promise<StalwartSnapshotSummary> {
    const raw: Record<string, unknown> = {};
    let error: string | null = null;
    const tryGet = async (path: string) => {
      try { return await this.get<Record<string, unknown>>(path); }
      catch (e: any) { error = error ?? e?.message ?? String(e); return null; }
    };
    const summary = await tryGet('/api/queue/summary');
    if (summary) raw.summary = summary;
    const info = await tryGet('/api/server/info');
    if (info) raw.info = info;

    const num = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
      return null;
    };
    const obj = summary as any;
    return {
      queueDepth:   num(obj?.queue?.depth ?? obj?.queueDepth ?? obj?.depth),
      queueFailed:  num(obj?.queue?.failed ?? obj?.queueFailed ?? obj?.failed),
      delivered24h: num(obj?.delivered_24h ?? obj?.delivered ?? obj?.messages?.delivered),
      bounced24h:   num(obj?.bounced_24h ?? obj?.bounced ?? obj?.messages?.bounced),
      rejected24h:  num(obj?.rejected_24h ?? obj?.rejected ?? obj?.messages?.rejected),
      tlsPercent:   num(obj?.tls_percent ?? obj?.tlsPercentage ?? obj?.tls?.percent),
      raw,
      error: summary ? null : error,
    };
  }
}
