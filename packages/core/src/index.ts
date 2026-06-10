// SPDX-License-Identifier: MIT
/**
 * @oddlyeven/kravla — polite web crawler with sitemap/RSS ingestion,
 * platform detection and content extraction.
 *
 * Server-only entry point (pulls in Crawlee). The municipality registry is
 * also available without any Crawlee/node baggage via the browser-safe
 * subpath export `@oddlyeven/kravla/municipalities`.
 */
export * from "./logger";
export * from "./options";

export * from "./crawl-runner";
export * from "./preview";
export * from "./robots";
export * from "./sitemap";
export * from "./scope";
export * from "./canonical-url";
export * from "./file-links";
export * from "./url-exclusions";
export * from "./extract";

export * from "./detectors";
export * from "./detectors/types";
export * from "./enrichers";
export * from "./enrichers/types";

export * from "./feed/discover";
export * from "./feed/parse";
export * from "./feed/streaming";
export * from "./feed/templates";
export * from "./feed/types";

export * from "./open-eplatform/runner";
export * from "./open-eplatform/streaming";
export * from "./open-eplatform/parser";
export * from "./open-eplatform/overview-parser";
export * from "./open-eplatform/municipalities";
export * from "./open-eplatform/types";
