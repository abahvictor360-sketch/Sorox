// Icons: Lucide (the same set the desktop app uses).
import { FileText, ListChecks, Mic, Target, User, type LucideIcon } from 'lucide-react';

const NAV: Record<string, LucideIcon> = { live: Mic, notes: FileText, practice: Target, prep: ListChecks, me: User };

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const C = NAV[name];
  return C ? <C size={size} strokeWidth={1.8} aria-hidden /> : null;
}
