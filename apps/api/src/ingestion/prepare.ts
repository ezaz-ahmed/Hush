import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { z } from 'zod';

// Ids from docs/content-sources.md.
export const frontmatterSchema = z.strictObject({
  title: z.string().min(1),
  license: z.enum(['LicenseRef-PublicDomain-USGov', 'LicenseRef-Hush-Original']),
  url: z.url({ protocol: /^https?$/ }).optional(),
});

// Bump when chunk options or the embedding model change: forces re-chunk and re-embed of all docs.
export const HASH_VERSION = '2';

export interface PreparedDocument {
  source: string;
  title: string;
  license: z.infer<typeof frontmatterSchema>['license'];
  url: string | null;
  contentHash: string;
  body: string;
}

export function prepareDocument(source: string, raw: string): PreparedDocument {
  const fail = (msg: string): never => {
    throw new Error(`${source}: ${msg}`);
  };

  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.startsWith('---\n')) return fail('missing frontmatter');
  const end = text.indexOf('\n---\n', 3);
  const endAtEof = text.endsWith('\n---') ? text.length - 4 : -1;
  const close = end !== -1 ? end : endAtEof;
  if (close === -1) return fail('unclosed frontmatter');

  let data: unknown;
  try {
    data = parse(text.slice(4, close + 1));
  } catch (e) {
    return fail(`invalid frontmatter YAML: ${e instanceof Error ? e.message : 'parse error'}`);
  }
  const parsed = frontmatterSchema.safeParse(data);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  const { title, license, url = null } = parsed.data;

  const stripped = text.slice(close + 5).replace(/<!--[\s\S]*?-->/g, '');
  if (stripped.includes('<!--')) return fail('unclosed HTML comment');

  const body = stripped
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (body === '') return fail('empty body');

  const contentHash = createHash('sha256')
    .update([HASH_VERSION, title, license, url ?? '', body].join('\n'))
    .digest('hex');
  return { source, title, license, url, contentHash, body };
}
