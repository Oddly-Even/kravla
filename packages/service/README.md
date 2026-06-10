# @oddlyeven/kravla-service

Headless HTTP wrapper around [`@oddlyeven/kravla`](../core). One container, one static API key,
HTTP in / pages out. No persistence or queue — a restart forgets running jobs and callers
re-submit; retries and scheduling belong to the consumer.

## Run

```sh
# local
CRAWLER_API_KEY=changeme bun packages/service/src/index.ts

# container
docker run -p 8080:8080 -e CRAWLER_API_KEY=changeme ghcr.io/oddly-even/kravla
```

| Env var                               | Default  | Meaning                                                       |
| ------------------------------------- | -------- | ------------------------------------------------------------- |
| `CRAWLER_API_KEY`                     | —        | Required (or set `KRAVLA_AUTH_DISABLED=true`, dev only).      |
| `PORT`                                | `8080`   | Listen port.                                                  |
| `HEALTH_PORT`                         | unset    | Optional extra listener serving only `/healthz`.              |
| `MAX_CONCURRENT_CRAWLS`               | `2`      | Active jobs beyond which submissions get `429`.               |
| `KRAVLA_WEBHOOK_ALLOW_PRIVATE`        | `false`  | Allow webhook callbacks to private addresses (dev/test only). |
| `KRAVLA_USER_AGENT`                   | `kravla` | robots.txt token + User-Agent base for all jobs.              |
| `KRAVLA_PAGE_CONCURRENCY`             | `1`      | Concurrent page fetches inside one crawl.                     |
| `KRAVLA_MEMORY_MBYTES`                | `1024`   | Crawlee pool budget per crawl — **not** a container limit.    |
| `KRAVLA_REQUEST_HANDLER_TIMEOUT_SECS` | `900`    | Per-page handler cap.                                         |
| `KRAVLA_MAX_HTML_BYTES`               | 8 MiB    | Max HTML body accepted; `0` disables.                         |

Auth on every `/v1/*` route: `Authorization: Bearer <key>` (or `X-Api-Key: <key>`).
robots.txt is always honored — there is no opt-out.

## POST /v1/crawls

```jsonc
{
  "url": "https://www.example.se",
  "crawl_type": "crawl", // crawl | sitemap | feed | open_eplatform
  "depth": 1,
  "scope": "depth_limited", // or path_prefix
  "http_auth": { "user": "u", "password": "p" },
  "exclude_url_patterns": ["*/kalender/*"],
  "index_linked_files": true,
  "limits": {
    "max_pages": 500,
    "max_seconds": 1800,
    "max_requests_per_minute": 60,
    "request_delay_seconds": 1,
  },
  "conditional_gets": [{ "url": "https://…", "etag": "\"abc\"", "last_modified": "…" }],
  "user_agent": "kravla", // per-job override of the robots/UA token
  "delivery": { "mode": "stream" }, // default
}
```

### Stream delivery (default)

`200` with `application/x-ndjson`. One JSON object per line, in crawl order:

```
{"type":"robots","robots":{"found":true,"seed_allowed":true,…}}
{"type":"page","page":{"url":…,"title":…,"raw_text":…,"etag":…,"last_modified":…,"file_links":[…],"metadata":…,"extra_chunks":…,"detected_platforms":[…]}}
{"type":"unchanged","url":…}                         // conditional GET answered 304
{"type":"failed","url":…,"status":"http_error|timeout|fetch_error","http_status":…,"error_message":…}
{"type":"skipped_robots","url":…}
{"type":"skipped_unavailable","url":…,"http_status":401}
{"type":"done","status":"completed|cancelled|failed","outcome":{"ok_count":…,…},"error":…}
```

Cancel by dropping the connection — the crawl aborts within a page.
`conditional_gets` keys are exact-match against crawled URLs; echo back URLs from prior
`page` events together with their `etag`/`last_modified` to skip unchanged pages.

### Webhook delivery

```jsonc
"delivery": { "mode": "webhook", "url": "https://consumer/hook", "secret": "…≥16 chars…", "batch_size": 25 }
```

Returns `202 {"job_id": "<uuid>"}` immediately. Events are POSTed to the callback in batches:

```jsonc
{ "job_id": "…", "sequence": 3, "events": [ … ], "done": { … } } // "done" only on the final POST
```

Headers: `X-Kravla-Signature: sha256=<hex HMAC-SHA256 of the raw body>`, `X-Kravla-Job-Id`,
`X-Kravla-Sequence`. Delivery is sequential and awaited by the crawler, so a slow receiver
backpressures the crawl; failed deliveries retry 3× then fail the job. Webhook URLs must not
resolve to private addresses unless `KRAVLA_WEBHOOK_ALLOW_PRIVATE=true`.

Verify in Python (e.g. from Eneo):

```python
import hmac, hashlib

def verify(secret: str, raw_body: bytes, signature_header: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

- `GET /v1/crawls/{job_id}` → `{job_id, status: running|completed|cancelled|failed, created_at, finished_at, delivered_batches, outcome, error}`
- `DELETE /v1/crawls/{job_id}` → `202`, aborts the crawl; the final webhook POST reports `status: "cancelled"`.

## POST /v1/preview

Dry-run probe of a candidate source — no indexing, ~seconds:

```jsonc
{ "url": "https://www.example.se", "crawl_type": "crawl", "depth": 1 }
```

`200` with `{seed, robots_txt, sitemap, sample_crawl, warnings}` (seed reachability, robots
verdict, sitemap discovery + URL counts, capped sample crawl, cross-check warnings).

## GET /healthz

`200 {"status":"ok","active_crawls":n}` — unauthenticated, for probes.
