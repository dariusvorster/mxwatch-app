import { Badge } from '@/components/ui/badge';
import { healthColor } from '@/lib/utils';

export function HealthScoreBadge({ score }: { score: number }) {
  const color = healthColor(score);
  const variant = color === 'red' ? 'destructive' : color === 'amber' ? 'warning' : 'success';
  return <Badge variant={variant}>{score}/100</Badge>;
}
