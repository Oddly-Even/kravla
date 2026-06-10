// SPDX-License-Identifier: MIT
/**
 * End-to-end service tests: real HTTP server on an ephemeral port, real
 * Crawlee runs against the in-process fixture server — no external network.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noopLogger } from "@oddlyeven/kravla";
import { createApp } from "../../src/app";
import type { ServiceConfig } from "../../src/config";
import { signBody } from "../../src/webhook";
import { startFixtureServer, type FixtureServer } from "../../../core/tests/helpers/fixture-server";

const API_KEY = "test-key-0123456789";

function makeConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    port: 0,
    healthPort: null,
    apiKey: API_KEY,
    maxConcurrentCrawls: 4,
    webhookAllowPrivate: true,
    userAgent: undefined,
    pageConcurrency: undefined,
    memoryMbytes: undefined,
    requestHandlerTimeoutSecs: undefined,
    maxHtmlBytes: undefined,
    ...overrides,
  };
}

async function startService(
  config: ServiceConfig,
): Promise<{ url: string; close: () => Promise<void> }> {
  const { handler } = createApp(config, noopLogger);
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

const authHeaders = { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" };

let fixtures: FixtureServer;
let service: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  fixtures = await startFixtureServer([
    {
      path: "/",
      title: "Root",
      bodyHtml: '<p>Welcome to the fixture town.</p><a href="/a">A</a><a href="/b">B</a>',
    },
    { path: "/a", title: "Page A", bodyHtml: "<p>Alpha content here.</p>" },
    { path: "/b", title: "Page B", bodyHtml: "<p>Beta content here.</p>" },
  ]);
  service = await startService(makeConfig());
});

afterAll(async () => {
  await service.close();
  await fixtures.close();
});

describe("auth + plumbing", () => {
  it("serves /healthz without auth", async () => {
    const res = await fetch(`${service.url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("rejects a missing API key with 401", async () => {
    const res = await fetch(`${service.url}/v1/crawls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: fixtures.url }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid body with 400 and zod issues", async () => {
    const res = await fetch(`${service.url}/v1/crawls`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ url: "not-a-url", depth: 99 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail: unknown[] };
    expect(body.detail.length).toBeGreaterThan(0);
  });

  it("404s on unknown job ids", async () => {
    const res = await fetch(`${service.url}/v1/crawls/00000000-0000-0000-0000-000000000000`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });
});

describe("stream mode", () => {
  it("streams NDJSON events and a terminal done", async () => {
    const res = await fetch(`${service.url}/v1/crawls`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ url: fixtures.url, crawl_type: "crawl", depth: 1 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");

    const lines = (await res.text()).trim().split("\n");
    const events = lines.map((l) => JSON.parse(l) as { type: string });

    expect(events[0]?.type).toBe("robots");
    const pages = events.filter((e) => e.type === "page") as {
      page: { url: string; title: string; raw_text: string };
    }[];
    expect(pages.length).toBe(3);
    expect(pages.map((p) => p.page.title).sort()).toEqual(["Page A", "Page B", "Root"]);
    expect(pages.every((p) => p.page.raw_text.length > 0)).toBe(true);

    const done = events.at(-1) as { type: string; status: string; outcome: { ok_count: number } };
    expect(done.type).toBe("done");
    expect(done.status).toBe("completed");
    expect(done.outcome.ok_count).toBe(3);
  });

  it("treats conditional-GET 304s as unchanged events", async () => {
    fixtures.setFixtures([
      { path: "/", title: "Root", bodyHtml: "<p>Etagged page.</p>", etag: '"v1"' },
    ]);
    try {
      // Cache-hint keys are exact-match against the crawled URL — consumers
      // echo back URLs from prior page events, so seed and hint align here.
      const res = await fetch(`${service.url}/v1/crawls`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          url: `${fixtures.url}/`,
          crawl_type: "crawl",
          depth: 0,
          conditional_gets: [{ url: `${fixtures.url}/`, etag: '"v1"' }],
        }),
      });
      const events = (await res.text())
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { type: string });
      expect(events.some((e) => e.type === "unchanged")).toBe(true);
      const done = events.at(-1) as { outcome: { unchanged_count: number } };
      expect(done.outcome.unchanged_count).toBe(1);
    } finally {
      fixtures.setFixtures([
        {
          path: "/",
          title: "Root",
          bodyHtml: '<p>Welcome to the fixture town.</p><a href="/a">A</a><a href="/b">B</a>',
        },
        { path: "/a", title: "Page A", bodyHtml: "<p>Alpha content here.</p>" },
        { path: "/b", title: "Page B", bodyHtml: "<p>Beta content here.</p>" },
      ]);
    }
  });
});

describe("webhook mode", () => {
  type Received = { body: string; signature: string | undefined; sequence: string | undefined };

  async function startReceiver(): Promise<{
    url: string;
    received: Received[];
    close: () => Promise<void>;
  }> {
    const received: Received[] = [];
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        received.push({
          body: Buffer.concat(chunks).toString("utf8"),
          signature: req.headers["x-kravla-signature"] as string | undefined,
          sequence: req.headers["x-kravla-sequence"] as string | undefined,
        });
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}/hook`,
      received,
      close: () =>
        new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    };
  }

  it("delivers signed batches, completes, and reports status", async () => {
    const receiver = await startReceiver();
    const secret = "super-secret-webhook-key";
    try {
      const submit = await fetch(`${service.url}/v1/crawls`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          url: fixtures.url,
          crawl_type: "crawl",
          depth: 1,
          delivery: { mode: "webhook", url: receiver.url, secret, batch_size: 2 },
        }),
      });
      expect(submit.status).toBe(202);
      const { job_id } = (await submit.json()) as { job_id: string };
      expect(job_id).toMatch(/^[0-9a-f-]{36}$/);

      // Poll status until the job settles.
      let status: { status: string; outcome: { ok_count: number } | null } | null = null;
      for (let i = 0; i < 100; i++) {
        const res = await fetch(`${service.url}/v1/crawls/${job_id}`, { headers: authHeaders });
        status = (await res.json()) as typeof status;
        if (status && status.status !== "running") break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(status?.status).toBe("completed");
      expect(status?.outcome?.ok_count).toBe(3);

      // Batches: 4 events (robots + 3 pages) at batch_size 2, plus done.
      expect(receiver.received.length).toBeGreaterThanOrEqual(2);
      for (const r of receiver.received) {
        expect(r.signature).toBe(signBody(secret, r.body));
      }
      const last = JSON.parse(receiver.received.at(-1)!.body) as {
        done?: { status: string; outcome: { ok_count: number } };
      };
      expect(last.done?.status).toBe("completed");
      expect(last.done?.outcome.ok_count).toBe(3);
      const allEvents = receiver.received.flatMap(
        (r) => (JSON.parse(r.body) as { events: { type: string }[] }).events,
      );
      expect(allEvents.filter((e) => e.type === "page").length).toBe(3);
    } finally {
      await receiver.close();
    }
  });

  it("refuses private webhook targets unless explicitly allowed", async () => {
    const guarded = await startService(makeConfig({ webhookAllowPrivate: false }));
    try {
      const res = await fetch(`${guarded.url}/v1/crawls`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          url: fixtures.url,
          delivery: {
            mode: "webhook",
            url: "http://127.0.0.1:9999/hook",
            secret: "super-secret-webhook-key",
          },
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("private");
    } finally {
      await guarded.close();
    }
  });
});

describe("preview + backpressure", () => {
  it("previews a source", async () => {
    const res = await fetch(`${service.url}/v1/preview`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ url: fixtures.url, crawl_type: "crawl", depth: 1 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      seed: { reachable: boolean };
      sample_crawl: { urls_discovered: number };
    };
    expect(body.seed.reachable).toBe(true);
    expect(body.sample_crawl.urls_discovered).toBeGreaterThanOrEqual(3);
  });

  it("429s when the concurrency cap is reached", async () => {
    const capped = await startService(makeConfig({ maxConcurrentCrawls: 0 }));
    try {
      const res = await fetch(`${capped.url}/v1/crawls`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ url: fixtures.url }),
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("30");
    } finally {
      await capped.close();
    }
  });
});
