# Extraction fidelity harness

Eval-only tooling to compare HTML→Markdown extraction candidates on real pages,
so we can decide whether to swap the crawler's extractor. It does **not** change
the production extractor (`src/lib/crawler/extract.ts`); it runs alternatives
beside it and writes their Markdown out for side-by-side reading.

## Why

Benchmarks showed the crawler's per-page CPU and memory cost was dominated by
`jsdom` (the DOM that `@mozilla/readability` ran on), not by Readability or
Turndown. This harness proved the fix: **Readability on linkedom produced
line-identical output to the jsdom path on every fixture (Δlines 0)** at ~6x
less CPU and memory, so production `extract.ts` now runs on linkedom and the
jsdom candidate was retired. Identical output also meant every existing
`contentHash` survived the swap — no re-embedding.

The remaining open question the harness tracks is **Defuddle**
(`kepano/defuddle`): a different extractor that emits Markdown directly and
handles short/listing pages better (where Readability bails to our cheerio
fallback). Its output _differs_ per page, so adopting it would invalidate
content hashes and re-embed the corpus — only worth it if retrieval evals show
extraction-related misses.

## Candidates

| id                  | what                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `current`           | live path: `extractContent()` — Readability on linkedom + Turndown |
| `defuddle-linkedom` | Defuddle (Markdown output) on linkedom                             |

See `candidates.ts`. Non-production candidates are fed a document from the
production `parseHtmlDocument` export (`extract.ts`), so URL/base handling is
identical across candidates by construction and the comparison cannot drift
from what production does.

## Run

```sh
bun run extraction:fidelity         # compare candidates over ./fixtures
bun run extraction:fidelity:fetch   # (re)download fixtures from urls.ts
```

Outputs land in `./out` (gitignored):

- `<fixture>.compare.md` — all candidates side by side under headings.
- `<fixture>.<id>.md` — each candidate alone (for `diff` / split-pane).
- `SUMMARY.md` — table of chars/words/Δlines/path/ms per fixture×candidate.

## Corpus

Fixtures (`./fixtures`, committed for offline/deterministic runs) span the real
crawl targets: municipal homepages (nav-heavy listing pages), deeper municipal
content/service pages (the RAG ingest target), and an article-shaped page. The
two ~1MB stress pages used for the perf benchmark are intentionally left out —
fidelity is about output quality, not throughput.

Add pages via `urls.ts`: every fixture **must** have a `FIXTURE_URLS` entry
holding the URL the HTML is actually served from (the final URL after
redirects — candidates resolve relative links against it, so a stale mapping
corrupts the comparison; `run.ts` hard-errors on unmapped fixtures and
`fetch.ts` refuses to save a fixture whose URL now redirects elsewhere).
`fetch.ts` decodes bodies charset-aware (legacy ISO-8859-1 municipal pages
would be mojibake'd by plain `res.text()`) and uses the house
`ladan/<component>` user-agent with a 12 s timeout.

## Reading the results

Word count is **not** a quality score. A higher count can mean an alternative
recovered real content Readability dropped — or that it kept boilerplate. The
**Δlines** column is the line-level delta vs `current` (0 = identical output) —
use it to spot which fixtures actually diverge, then open the `.compare.md`
files and look for: missing main content, retained nav/footer/cookie noise,
relative vs absolute links, broken tables, and whether `current` fell back to
the cheerio path (`path=cheerio-fallback`).
