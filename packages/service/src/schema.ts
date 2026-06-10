// SPDX-License-Identifier: MIT
/**
 * Wire schemas for the v1 API. snake_case on the wire (Python-friendly —
 * Eneo is the first consumer), camelCase internally.
 */
import { z } from "zod";

const HttpAuthSchema = z.object({
  user: z.string().min(1),
  password: z.string(),
});

const LimitsSchema = z.object({
  /** Maps to Crawlee's maxRequestsPerCrawl. */
  max_pages: z.number().int().min(1).optional(),
  /** Wall-clock cap for the whole job; the crawl is aborted when it fires. */
  max_seconds: z.number().int().min(1).optional(),
  max_requests_per_minute: z.number().int().min(1).optional(),
  /** Minimum gap between two requests to the same host. */
  request_delay_seconds: z.number().min(0).optional(),
});

const ConditionalGetSchema = z.object({
  url: z.url(),
  etag: z.string().nullish(),
  last_modified: z.string().nullish(),
});

const DeliverySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("stream") }),
  z.object({
    mode: z.literal("webhook"),
    url: z.url(),
    /** HMAC-SHA256 key for the X-Kravla-Signature header on every callback. */
    secret: z.string().min(16, "webhook secret must be at least 16 characters"),
    batch_size: z.number().int().min(1).max(500).default(25),
  }),
]);

export const CrawlRequestSchema = z.object({
  url: z.url(),
  crawl_type: z.enum(["crawl", "sitemap", "feed", "open_eplatform"]).default("crawl"),
  depth: z.number().int().min(0).max(10).default(1),
  scope: z.enum(["depth_limited", "path_prefix"]).optional(),
  http_auth: HttpAuthSchema.nullish(),
  exclude_url_patterns: z.array(z.string()).max(200).optional(),
  index_linked_files: z.boolean().optional(),
  limits: LimitsSchema.optional(),
  conditional_gets: z.array(ConditionalGetSchema).max(50_000).optional(),
  /** Override the robots/User-Agent product token for this job. */
  user_agent: z.string().min(1).max(200).optional(),
  delivery: DeliverySchema.default({ mode: "stream" }),
});

export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;
export type WebhookDelivery = Extract<CrawlRequest["delivery"], { mode: "webhook" }>;

export const PreviewRequestSchema = z.object({
  url: z.url(),
  crawl_type: z.enum(["crawl", "sitemap"]).default("crawl"),
  depth: z.number().int().min(0).max(10).default(1),
  scope: z.enum(["depth_limited", "path_prefix"]).optional(),
  http_auth: HttpAuthSchema.nullish(),
  exclude_url_patterns: z.array(z.string()).max(200).optional(),
  max_sample_fetches: z.number().int().min(1).max(200).optional(),
  user_agent: z.string().min(1).max(200).optional(),
});

export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;
