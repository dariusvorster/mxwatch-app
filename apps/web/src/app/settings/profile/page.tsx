'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MAX_BYTES = 200 * 1024;
const TARGET_SIZE = 256; // square edge we resize uploads down to

/**
 * Reads a File, draws it into a square 256×256 canvas (cover-style),
 * and returns a data URL. Keeps stored avatars tiny regardless of what
 * the user uploads.
 */
async function fileToResizedDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Not an image'));
    i.src = raw;
  });
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_SIZE; canvas.height = TARGET_SIZE;
  const ctx = canvas.getContext('2d')!;
  // Cover-crop the source into the square canvas
  const scale = Math.max(TARGET_SIZE / img.width, TARGET_SIZE / img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, (TARGET_SIZE - w) / 2, (TARGET_SIZE - h) / 2, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export default function ProfilePage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  useEffect(() => { if (!isPending && !session) router.push('/login'); }, [isPending, session, router]);

  const profile = trpc.profile.get.useQuery(undefined, { enabled: !!session });
  const update = trpc.profile.update.useMutation({ onSuccess: () => profile.refetch() });
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile.data) {
      if (name === '') setName(profile.data.name ?? '');
      if (preview === null) setPreview(profile.data.image ?? null);
    }
  }, [profile.data]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null); setOk(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES * 4) return setErr('Image too large (max ~800KB original).');
    try {
      const url = await fileToResizedDataUrl(file);
      setPreview(url);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not read image');
    }
  }

  async function save() {
    setErr(null); setOk(null); setBusy(true);
    try {
      await update.mutateAsync({
        name: name.trim() || null,
        image: preview,
      });
      setOk('Saved.');
    } catch (e: any) {
      setErr(e?.message ?? 'Save failed');
    } finally { setBusy(false); }
  }

  async function removeAvatar() {
    setErr(null); setOk(null); setBusy(true);
    try {
      await update.mutateAsync({ image: null });
      setPreview(null);
      setOk('Avatar cleared.');
    } catch (e: any) {
      setErr(e?.message ?? 'Clear failed');
    } finally { setBusy(false); }
  }

  if (isPending || !session) return <main>Loading…</main>;

  const initial = (profile.data?.email ?? 'U')[0]!.toUpperCase();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 620 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Profile
        </h1>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          {profile.data?.email}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Avatar</CardTitle>
          <CardDescription>PNG / JPEG / WEBP. Resized to 256×256 on upload.</CardDescription>
        </CardHeader>
        <CardContent style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <div style={{
            width: 80, height: 80, borderRadius: 40,
            background: preview ? `center/cover url(${preview})` : 'var(--blue-dim)',
            color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 600,
            border: '1px solid var(--border)',
          }}>
            {preview ? '' : initial}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} style={{ fontSize: 12 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="outline" onClick={() => fileRef.current?.click()}>Choose file…</Button>
              {preview && <Button variant="outline" onClick={removeAvatar} disabled={busy}>Remove</Button>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Display name</CardTitle>
          <CardDescription>Shown in the sidebar and in outbound alert email signatures.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          {err && <p style={{ color: 'var(--red)', fontSize: 12 }}>{err}</p>}
          {ok && <p style={{ color: 'var(--green)', fontSize: 12 }}>{ok}</p>}
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password & security</CardTitle>
          <CardDescription>2FA, sessions, API tokens, IP allowlist, and password change all live on the Security page.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/security"><Button variant="outline">Open Security settings</Button></Link>
        </CardContent>
      </Card>
    </div>
  );
}
