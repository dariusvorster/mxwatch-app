'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';

export function DomainSearch() {
  const router = useRouter();
  const { data: session } = useSession();
  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const list = domains.data ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return list.slice(0, 8);
    return list.filter((d) => d.domain.toLowerCase().includes(term)).slice(0, 8);
  }, [domains.data, q]);

  useEffect(() => { setHighlight(0); }, [q]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  function go(id: string) {
    setOpen(false);
    setQ('');
    router.push(`/domains/${id}`);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 240 }}>
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') {
            const m = matches[highlight];
            if (m) go(m.id);
          }
        }}
        placeholder="Search domains…   ⌘K"
        style={{
          width: '100%',
          fontFamily: 'var(--mono)', fontSize: 12,
          padding: '7px 12px', borderRadius: 8,
          border: '1px solid var(--border2)',
          background: 'var(--bg2)',
          color: 'var(--text)',
        }}
      />
      {open && matches.length > 0 && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            width: 320, maxHeight: 320, overflowY: 'auto',
            background: 'var(--surf)',
            border: '1px solid var(--border2)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            zIndex: 20,
          }}
        >
          {matches.map((d, i) => (
            <button
              key={d.id}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => go(d.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '8px 12px',
                background: i === highlight ? 'var(--bg2)' : 'transparent',
                border: 'none',
                borderBottom: i < matches.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>
                {d.domain}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                open →
              </span>
            </button>
          ))}
        </div>
      )}
      {open && q.trim() && matches.length === 0 && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            width: 320, padding: '10px 12px',
            background: 'var(--surf)',
            border: '1px solid var(--border2)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12, color: 'var(--text3)',
            zIndex: 20,
          }}
        >
          No domain matches “{q}”.
        </div>
      )}
    </div>
  );
}
