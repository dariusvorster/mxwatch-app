'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function Verify2FAPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setError(null); setBusy(true);
    try {
      const res = mode === 'totp'
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code });
      if ((res as any)?.error) throw new Error((res as any).error.message ?? 'Verification failed');
      router.push('/');
    } catch (e: any) {
      setError(e?.message ?? 'Invalid code');
    } finally { setBusy(false); }
  }

  return (
    <main style={{ maxWidth: 420, margin: '80px auto', padding: 24 }}>
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            {mode === 'totp'
              ? 'Enter the 6-digit code from your authenticator app.'
              : 'Enter one of your one-time backup codes.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">{mode === 'totp' ? '6-digit code' : 'Backup code'}</Label>
            <Input
              id="code"
              inputMode={mode === 'totp' ? 'numeric' : 'text'}
              maxLength={mode === 'totp' ? 6 : 32}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={mode === 'totp' ? '123456' : 'xxxx-xxxx-xxxx'}
              autoFocus
            />
          </div>
          {error && <p style={{ color: 'var(--red)', fontSize: 12 }}>{error}</p>}
          <Button onClick={verify} disabled={!code || busy}>{busy ? 'Verifying…' : 'Verify'}</Button>
          <button
            type="button"
            onClick={() => { setMode(mode === 'totp' ? 'backup' : 'totp'); setCode(''); setError(null); }}
            style={{
              background: 'none', border: 'none', color: 'var(--text3)',
              fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            {mode === 'totp' ? 'Use a backup code instead' : 'Use authenticator code instead'}
          </button>
        </CardContent>
      </Card>
    </main>
  );
}
