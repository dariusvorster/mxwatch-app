import { describe, it, expect } from 'vitest';
import { toCsv } from '../../apps/web/src/lib/csv';

describe('toCsv', () => {
  it('serialises a simple row set', () => {
    const csv = toCsv([{ a: 1, b: 'hello' }], [
      { header: 'a', get: (r) => r.a },
      { header: 'b', get: (r) => r.b },
    ]);
    expect(csv).toBe('a,b\r\n1,hello\r\n');
  });

  it('quotes fields containing commas, quotes, and newlines', () => {
    const csv = toCsv([{ msg: 'a,b' }, { msg: 'with "quote"' }, { msg: 'line\nbreak' }], [
      { header: 'msg', get: (r) => r.msg },
    ]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"with ""quote"""');
    expect(csv).toContain('"line\nbreak"');
  });

  it('emits header only for empty rows', () => {
    const csv = toCsv<{ a: number }>([], [{ header: 'a', get: (r) => r.a }]);
    expect(csv).toBe('a\r\n');
  });

  it('serialises Date as ISO', () => {
    const when = new Date('2026-04-13T10:00:00Z');
    const csv = toCsv([{ t: when }], [{ header: 't', get: (r) => r.t }]);
    expect(csv).toContain('2026-04-13T10:00:00.000Z');
  });

  it('handles null/undefined as empty', () => {
    const csv = toCsv([{ a: null, b: undefined }], [
      { header: 'a', get: (r) => r.a },
      { header: 'b', get: (r) => r.b },
    ]);
    expect(csv).toBe('a,b\r\n,\r\n');
  });
});
