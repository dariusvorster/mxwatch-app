'use client';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface TimelinePoint {
  date: string;
  pass: number;
  fail: number;
}

export function DmarcTimelineChart({ data }: { data: TimelinePoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data in this window.</p>;
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="pass" name="Pass" stackId="dmarc" fill="hsl(142 71% 45%)" />
          <Bar dataKey="fail" name="Fail" stackId="dmarc" fill="hsl(0 84% 60%)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
