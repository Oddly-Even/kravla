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

## Run as a service

For non-Node consumers (Eneo, anything that speaks HTTP), run the headless service instead of
embedding the library — one container, one API key, HTTP in / pages out:

```sh
# local
CRAWLER_API_KEY=changeme bun packages/service/src/index.ts

# container
docker build -t kravla-service .
docker run -p 8080:8080 -e CRAWLER_API_KEY=changeme kravla-service
# (or pull ghcr.io/oddly-even/kravla once a release is tagged)
```

Then stream a crawl as NDJSON:

```sh
curl -N -X POST http://localhost:8080/v1/crawls \
  -H "authorization: Bearer changeme" -H "content-type: application/json" \
  -d '{"url": "https://www.example.se", "depth": 1, "limits": {"max_pages": 50}}'
```

Each line is one event (`robots`, `page`, `failed`, …) ending with a terminal `done` summary.
Webhook delivery (HMAC-signed batches + job status/cancel endpoints), the `/v1/preview` dry-run,
and the full env-var reference are documented in
[`packages/service/README.md`](packages/service/README.md).

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
