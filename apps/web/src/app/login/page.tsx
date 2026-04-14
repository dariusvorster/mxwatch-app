'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { signIn } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BrandMark } from '@/components/brand-mark';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const parsed = schema.safeParse({ email: fd.get('email'), password: fd.get('password') });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setLoading(true);
    const res = await signIn.email({ email: parsed.data.email, password: parsed.data.password });
    setLoading(false);
    if (res.error) return setError(res.error.message ?? 'Sign in failed');
    router.push('/');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <BrandMark size={22} />
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle style={{ fontFamily: 'var(--sans)', fontSize: 18, fontWeight: 600 }}>Sign in</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              No account? <a href="/signup" className="underline">Sign up</a>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
