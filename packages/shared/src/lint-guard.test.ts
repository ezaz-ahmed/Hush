import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Guards the root eslint.config.js for every workspace (lives here because the root has no test runner):
// dropping or weakening these rules must fail `pnpm test`.
const root = path.resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({ cwd: root });

const severity = async (file: string, rule: string) =>
  (
    (await eslint.calculateConfigForFile(path.join(root, file))) as {
      rules: Record<string, unknown[]>;
    }
  ).rules[rule]?.[0];

const importRules = ['first', 'newline-after-import', 'no-duplicates', 'order'];
const files = ['apps/api/src/x.ts', 'apps/web/src/x.ts', 'packages/shared/src/x.ts'];

describe('import-x lint guard', () => {
  it.each(files.flatMap((f) => importRules.map((r) => [f, r] as const)))(
    '%s has import-x/%s as error',
    async (file, rule) => {
      expect(await severity(file, `import-x/${rule}`)).toBe(2);
    },
  );

  it('flags a default export in packages/shared', async () => {
    expect(await severity('packages/shared/src/x.ts', 'import-x/no-default-export')).toBe(2);
  });

  it.each(['apps/web/src/app/page.tsx', 'apps/api/src/x.ts'])(
    'allows a default export in %s',
    async (file) => {
      expect(await severity(file, 'import-x/no-default-export')).toBeUndefined();
    },
  );
});
