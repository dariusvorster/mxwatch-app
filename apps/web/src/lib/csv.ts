export interface CsvColumn<T> {
  header: string;
  get: (row: T) => unknown;
}

function escape(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escape(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escape(c.get(r))).join(',')).join('\r\n');
  return rows.length > 0 ? `${header}\r\n${body}\r\n` : `${header}\r\n`;
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
