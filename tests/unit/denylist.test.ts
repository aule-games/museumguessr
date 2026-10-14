import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { buildMatcher, normalize } from '../../scripts/lib/denylist.mjs';

describe('[ENG7] denylist matcher', () => {
  const match = buildMatcher(['Acme Widgets', 'Şirket', 'Dağ']);
  it('finds space, hyphen, underscore, joined and URL-encoded variants', () => {
    for (const t of ['acme widgets', 'ACME-WIDGETS', 'acme_widgets', 'acmewidgets', 'acme%20widgets', 'acme+widgets']) {
      expect(match(`x ${t} y`)).toEqual([{ term: 1, line: 1 }]);
    }
  });
  it('folds Turkish letters and accents', () => {
    expect(match('SIRKET')).toEqual([{ term: 2, line: 1 }]);
    expect(match('dag')).toEqual([{ term: 3, line: 1 }]);
    expect(normalize('İstanbul ılık')).toBe('istanbul ilik');
  });
  it('masks the approved exemptions', () => {
    const m = buildMatcher(['mert', 'aktas']);
    expect(m('https://mert-aktas.github.io/museumguessr/ and 1+mert-aktas@users.noreply.github.com')).toEqual([]);
    expect(m('mert')).toEqual([{ term: 1, line: 1 }]);
  });
  it('a term written as =word matches whole words only', () => {
    const m = buildMatcher(['=Vega']);
    for (const t of ['Vega', 'the vega/3a branch', '.vega/notes', 'VEGA 3b']) expect(m(t), t).toEqual([{ term: 1, line: 1 }]);
    for (const t of ['vegan', 'Vegas', 'novegaland']) expect(m(t), t).toEqual([]);
  });
  it('reports line numbers, never the term', () => {
    const hits = match('ok\nok\nacme widgets');
    expect(hits).toEqual([{ term: 1, line: 3 }]);
    expect(JSON.stringify(hits)).not.toContain('acme');
  });
});
