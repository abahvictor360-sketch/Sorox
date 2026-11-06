import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/components/Markdown';

const EMOJI = /\p{Extended_Pictographic}/u;

describe('AI text shows icons, not emoji', () => {
  it('turns status marks into icons and drops other emoji', () => {
    const html = renderToStaticMarkup(<Markdown text={'- ✅ **TypeScript**: 6 years\n- 🟡 Kubernetes: some\n- ❌ Go: none\n\n🚀 Ready to go — good luck 🎉'} />);
    expect(EMOJI.test(html)).toBe(false);
    expect(html).not.toContain('—');
    expect(html).toContain('mi-ok');
    expect(html).toContain('mi-warn');
    expect(html).toContain('mi-bad');
    expect(html).toContain('Ready to go, good luck');
  });
  it('leaves normal text alone', () => {
    const html = renderToStaticMarkup(<Markdown text={'**I led the migration.** Costs fell 20% (£80k).'} />);
    expect(html).toContain('<strong>I led the migration.</strong> Costs fell 20% (£80k).');
  });
});
