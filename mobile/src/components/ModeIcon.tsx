import { Briefcase, Code2, GraduationCap, Sparkles, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import type { ModeId } from '../lib/settings';

const MODE: Record<ModeId, LucideIcon> = {
  interview: Briefcase, technical: Code2, sales: TrendingUp, meeting: Users, lecture: GraduationCap, general: Sparkles,
};

export function ModeIcon({ id, size = 16 }: { id: ModeId; size?: number }) {
  const C = MODE[id] ?? Sparkles;
  return <C size={size} strokeWidth={1.9} aria-hidden className="ico" />;
}
