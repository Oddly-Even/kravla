# kravla

Polite web crawler. Crawlee-based page crawling, sitemap and RSS/Atom ingestion, Open ePlatform
e-service harvesting, platform detection (Sitevision, EpiServer, Netpublicator, …) and
Readability-based content extraction. Works on any site; battle-tested against hundreds of real
Swedish municipal hosts and their CDN quirks.

| Package                                         | What it is                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| [`@oddlyeven/kravla`](packages/core)            | The crawler library — embed it in-process (Node ≥ 20, ESM).                |
| [`@oddlyeven/kravla-service`](packages/service) | Headless HTTP wrapper — NDJSON streaming + signed webhooks, one container. |

## Library quick start

```ts
import { runCrawl } from "@oddlyeven/kravla";

const outcome = await runCrawl({
  seedUrl: "https://www.example.se",
  crawlType: "crawl", // "crawl" | "sitemap" | "feed" | "open_eplatform"
  depth: 2,
  logger: pinoInstance, // optional — any pino-compatible logger; silent by default
  userAgent: "kravla", // robots.txt token + User-Agent base
  onPage: async (page) => {
    // page.url, page.title, page.rawText (markdown), page.metadata,
    // page.detectedPlatforms, page.fileLinks, etag/lastModified …
  },
  onFailed: async (failure) => {},
});
```

robots.txt is always honored (no opt-out): rules are matched against the `userAgent` token,
`Crawl-delay` is enforced as a hard same-host gap, and `Sitemap:` directives drive discovery.

Runtime knobs (all optional, defaults in parentheses): `pageConcurrency` (1), `memoryMbytes`
(1024), `requestHandlerTimeoutSecs` (900), `maxHtmlBytes` (8 MiB, 0 = unlimited).

### Browser-safe municipality registry

The static SKL registry of Swedish municipalities (with verified Open ePlatform portals) ships
as a separate entry point with zero crawler dependencies — safe for client bundles:

```ts
import { allMunicipalities } from "@oddlyeven/kravla/municipalities";
```

### Other entry points

- `previewCrawlSource(input)` — dry-run estimate (seed probe + robots + sitemap + sample crawl).
- `loadSitemap(seedUrl)` / `probeSitemapStatus(seedUrl)` — native-fetch sitemap loader
  (sidesteps the got-scraping HTTP/2 bug that breaks CDN-fronted .se hosts).
- `fetchAndParseFeed(url)` — RSS/Atom with autodiscovery and conditional GET.
- `runOpenEplatformCrawl(input)` — harvest a municipality's e-service catalog.
- `loadRobotsPolicyForUrl`, `canonicalizeSourceUrl`, `extractContent`, `runDetectors`,
  `runEnrichers`, …

## Development

```sh
bun install
bun run typecheck && bun run lint && bun run build && bun run test
```

QA tooling lives in [`scripts/`](scripts): `bun run detect:municipal-services` scans the SKL
corpus with every platform detector; `bun run extraction:fidelity` compares extraction
candidates against captured fixtures.

## License

[MIT](LICENSE) © Oddly Even AB
