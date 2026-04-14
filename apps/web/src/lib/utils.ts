import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function healthColor(score: number): 'red' | 'amber' | 'green' {
  if (score < 50) return 'red';
  if (score < 80) return 'amber';
  return 'green';
}
