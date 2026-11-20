import { describe, expect, it } from 'vitest';
import { DEFAULT_VOYAGE_MODEL } from '../embedding/voyage-embedding-provider.js';
import { DEFAULT_CHUNK_OPTIONS } from './chunk.js';
import { HASH_VERSION } from './prepare.js';

describe('content hash inputs', () => {
  it('are pinned', () => {
    // If this fails, bump HASH_VERSION in prepare.ts so ingest re-chunks and re-embeds every file.
    expect({ HASH_VERSION, DEFAULT_CHUNK_OPTIONS, DEFAULT_VOYAGE_MODEL }).toMatchInlineSnapshot(`
      {
        "DEFAULT_CHUNK_OPTIONS": {
          "maxChars": 1000,
          "overlapChars": 150,
        },
        "DEFAULT_VOYAGE_MODEL": "voyage-3.5",
        "HASH_VERSION": "2",
      }
    `);
  });
});
