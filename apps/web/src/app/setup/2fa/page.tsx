'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type Stage = 'password' | 'show-uri' | 'show-backup' | 'done';

export default function Setup2FAPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enable() {
    setError(null); setBusy(true);
    try {
      const res = await authClient.twoFactor.enable({ password });
      const data: any = (res as any)?.data ?? res;
      const uri: string | undefined = data?.totpURI ?? data?.uri;
      const codes: string[] | undefined = data?.backupCodes;
      if (!uri) throw new Error('Did not receive TOTP URI from server');
      setTotpUri(uri);
      const secretMatch = uri.match(/[?&]secret=([^&]+)/);
      setManualKey(secretMatch ? decodeURIComponent(secretMatch[1]!) : null);
      if (codes) setBackupCodes(codes);
      setStage('show-uri');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to enable 2FA');
    } finally { setBusy(false); }
  }

  async function verify() {
    setError(null); setBusy(true);
    try {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if ((res as any)?.error) throw new Error((res as any).error.message ?? 'Verification failed');
      setStage('show-backup');
    } catch (e: any) {
      setError(e?.message ?? 'Invalid code');
    } finally { setBusy(false); }
  }

  function downloadBackups() {
    const blob = new Blob([backupCodes.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mxwatch-2fa-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={{ maxWidth: 520, margin: '60px auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>
        Set up two-factor authentication
      </h1>

      {stage === 'password' && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm your password</CardTitle>
            <CardDescription>We'll generate a TOTP secret and backup codes after you confirm.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: 12 }}>{error}</p>}
            <Button onClick={enable} disabled={!password || busy}>{busy ? 'Working…' : 'Continue'}</Button>
          </CardContent>
        </Card>
      )}

      {stage === 'show-uri' && (
        <Card>
          <CardHeader>
            <CardTitle>Add MxWatch to your authenticator</CardTitle>
            <CardDescription>
              Open your authenticator app (1Password, Authy, Google Authenticator, Bitwarden…) and add a new TOTP entry
              using either the URI or the secret below. Then enter the 6-digit code it shows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {totpUri && (
              <div>
                <Label>otpauth URI (tap-and-hold / paste into app)</Label>
                <code style={{
                  display: 'block', marginTop: 6, padding: 10,
                  background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-all', userSelect: 'all',
                }}>{totpUri}</code>
              </div>
            )}
            {manualKey && (
              <div>
                <Label>Or enter this secret manually</Label>
                <code style={{
                  display: 'block', marginTop: 6, padding: 10,
                  background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: '0.05em', userSelect: 'all',
                }}>{manualKey}</code>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="code">6-digit code</Label>
              <Input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: 12 }}>{error}</p>}
            <Button onClick={verify} disabled={code.length !== 6 || busy}>{busy ? 'Verifying…' : 'Verify & enable'}</Button>
          </CardContent>
        </Card>
      )}

      {stage === 'show-backup' && (
        <Card>
          <CardHeader>
            <CardTitle>Save your backup codes</CardTitle>
            <CardDescription>Each can be used once to get in if you lose your authenticator. Store them somewhere safe — they won't be shown again.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)',
              background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              padding: 14,
              display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
            }}>
              {backupCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <Button variant="outline" onClick={downloadBackups}>Download as .txt</Button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2)' }}>
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              I have saved my backup codes.
            </label>
            <Button onClick={() => router.push('/')} disabled={!saved}>Finish</Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
