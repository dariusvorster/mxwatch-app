/**
 * Stalwart catchall setup for the deliverability-inbox "stalwart_relay"
 * mode. Best-effort: tries to POST a Sieve script via the Stalwart
 * management API. When that fails (older Stalwart without Sieve upload,
 * locked-down deployment, etc.) the caller can surface the generated
 * script text so the user pastes it into the Stalwart admin UI themselves.
 */

export interface CatchallSetup {
  /** The Sieve script that needs to be installed on Stalwart. */
  sieveScript: string;
  /** Catchall address users send test email to — `mxwatch-test-*@<domain>`. */
  catchallAddressPattern: string;
  /** True when the script was uploaded via API; false means user must paste. */
  uploaded: boolean;
  /** Error message when uploaded=false, or a note when uploaded=true. */
  message: string;
}

export function buildSieveScript(webhookUrl: string, webhookSecret: string): string {
  // Stalwart supports the vnd.stalwart.http sieve extension for fan-out-to-
  // HTTP. We match any recipient whose local-part starts with "mxwatch-test-"
  // and POST the raw RFC822 message to the MxWatch webhook, then discard so
  // the message never lands in a mailbox.
  return `require ["vnd.stalwart.http", "envelope"];

if envelope :localpart :contains "to" "mxwatch-test-" {
  http :method "POST"
       :url "${webhookUrl}"
       :header "X-Webhook-Secret: ${webhookSecret}"
       :header "Content-Type: message/rfc822"
       :body "raw";
  discard;
}
`;
}

export async function uploadSieveScript(params: {
  baseUrl: string;
  apiToken: string;
  scriptName: string;
  script: string;
}): Promise<{ ok: boolean; message: string }> {
  const base = params.baseUrl.replace(/\/$/, '');
  const candidates = [
    { method: 'PUT' as const, path: `/api/sieve/${encodeURIComponent(params.scriptName)}` },
    { method: 'POST' as const, path: `/api/sieve/${encodeURIComponent(params.scriptName)}` },
    { method: 'PUT' as const, path: `/api/principal/main/sieve/${encodeURIComponent(params.scriptName)}` },
  ];
  let lastError = 'No known Sieve endpoint accepted the script';
  for (const c of candidates) {
    try {
      const res = await fetch(`${base}${c.path}`, {
        method: c.method,
        headers: {
          Authorization: `Bearer ${params.apiToken}`,
          'Content-Type': 'application/sieve',
        },
        body: params.script,
      });
      if (res.ok) return { ok: true, message: `Uploaded via ${c.method} ${c.path}` };
      lastError = `${c.method} ${c.path} → ${res.status}`;
    } catch (e: any) {
      lastError = `${c.method} ${c.path} → ${e?.message ?? 'network error'}`;
    }
  }
  return { ok: false, message: lastError };
}

/**
 * One-stop setup for a user's Stalwart catchall. Generates the script,
 * attempts upload, and returns enough context for the UI to either
 * confirm success or show the script for manual install.
 */
export async function setupStalwartCatchall(params: {
  baseUrl: string;
  apiToken: string;
  webhookUrl: string;
  webhookSecret: string;
  primaryDomain: string;
  scriptName?: string;
}): Promise<CatchallSetup> {
  const script = buildSieveScript(params.webhookUrl, params.webhookSecret);
  const upload = await uploadSieveScript({
    baseUrl: params.baseUrl,
    apiToken: params.apiToken,
    scriptName: params.scriptName ?? 'mxwatch-deliverability',
    script,
  });
  return {
    sieveScript: script,
    catchallAddressPattern: `mxwatch-test-*@${params.primaryDomain}`,
    uploaded: upload.ok,
    message: upload.message,
  };
}
