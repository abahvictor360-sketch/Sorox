// Minimal, safe markdown for AI replies: headings, bullets, numbered lists,
// bold, italic and inline code. Builds React elements (no innerHTML).
import { Fragment, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';

// The AI sometimes marks things with emoji (✅ 🟡 ❌). Status marks become real
// icons; any other emoji is dropped.
const STATUS: { re: RegExp; node: (k: string) => ReactNode }[] = [
  { re: /^(✅|✔️?|☑️?|🟢)$/u, node: (k) => <CircleCheck key={k} size={15} className="mi-ok" aria-label="yes" /> },
  { re: /^(❌|✖️?|❎|🔴|⛔)$/u, node: (k) => <CircleX key={k} size={15} className="mi-bad" aria-label="no" /> },
  { re: /^(🟡|🟠|⚠️?|❗|❕|‼️?)$/u, node: (k) => <CircleAlert key={k} size={15} className="mi-warn" aria-label="partly" /> },
];
const EMOJI = /(\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*|[\u2714\u2716]\uFE0F?)/gu;

/** Text with status emoji as icons and other emoji removed. */
export function iconize(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0; let i = 0; let m: RegExpExecArray | null;
  EMOJI.lastIndex = 0;
  while ((m = EMOJI.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const status = STATUS.find((s) => s.re.test(m![0]));
    if (status) out.push(status.node(`${key}-e${i++}`));
    last = m.index + m[0].length;
    // swallow the space a removed emoji leaves at the start of a line
    if (!status && text[last] === ' ' && (m.index === 0 || text[m.index - 1] === ' ')) last++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...iconize(text.slice(last, m.index), `${key}-t${i}`));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{iconize(tok.slice(2, -2), k)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{iconize(tok.slice(1, -1), k)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(...iconize(text.slice(last), `${key}-end`));
  return out;
}

/** House style: no em dashes, even if the AI writes one anyway. */
export function noEmDash(text: string): string {
  return text.replace(/\s*—\s*/g, (m, off: number, all: string) => (off === 0 || off + m.length >= all.length ? ' ' : ', ')).trim();
}

export function Markdown({ text }: { text: string }) {
  const lines = noEmDash(text).replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const k = `l${blocks.length}`;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `${k}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
    list = null;
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const head = line.match(/^(#{1,4})\s+(.*)$/);
    if (bullet || num) {
      const ordered = !!num && !bullet;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
      return;
    }
    flush();
    if (!line.trim()) return;
    if (head) { blocks.push(<h4 key={`h${idx}`} className={`md-h${head[1].length}`}>{inline(head[2], `h${idx}`)}</h4>); return; }
    if (/^-{3,}$/.test(line.trim())) { blocks.push(<hr key={`r${idx}`} />); return; }
    blocks.push(<p key={`p${idx}`}>{inline(line, `p${idx}`)}</p>);
  });
  flush();
  return <div className="md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
