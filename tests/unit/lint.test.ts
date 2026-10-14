import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: `${import.meta.dirname}/../..` });
const lint = async (code: string, file: string) => (await eslint.lintText(code, { filePath: file }))[0]?.messages.map((m) => m.message) ?? [];

describe('[ENG34] [DX30] [SEC1] [DS30] source lint rules', () => {
  it('rejects innerHTML in src', async () => {
    expect((await lint('document.body.innerHTML = "x";\n', 'src/fixture.ts')).join()).toContain('SEC1');
  });
  it('rejects event-name literals outside events.ts', async () => {
    expect((await lint("export const n = 'round_completed';\n", 'src/fixture.ts')).join()).toContain('DX30');
  });
  it('rejects ?src= links', async () => {
    expect((await lint("export const u = 'https://x.io/?src=share';\n", 'src/fixture.ts')).join()).toContain('PH3');
  });
  it('rejects "owns" in the copy deck', async () => {
    expect((await lint("export const C = { a: 'The museum owns it.' };\n", 'src/copy.ts')).join()).toContain('DS30');
  });
});
