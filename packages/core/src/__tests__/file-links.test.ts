// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { isNonHtmlUrl } from "../file-links";

describe("crawler URL type filter", () => {
  it("keeps dotted HTML-like routes crawlable", () => {
    expect(isNonHtmlUrl("https://example.test/press.release")).toBe(false);
    expect(isNonHtmlUrl("https://example.test/news/2026.05.27")).toBe(false);
    expect(isNonHtmlUrl("https://example.test/about.v2?preview=1")).toBe(false);
  });

  it("filters known non-HTML assets", () => {
    expect(isNonHtmlUrl("https://example.test/files/report.pdf")).toBe(true);
    expect(isNonHtmlUrl("https://example.test/files/minutes.docx")).toBe(true);
    expect(isNonHtmlUrl("https://example.test/assets/logo.svg")).toBe(true);
    expect(isNonHtmlUrl("https://example.test/assets/source.psd")).toBe(true);
    expect(isNonHtmlUrl("https://example.test/assets/app.css")).toBe(true);
    expect(isNonHtmlUrl("https://example.test/assets/app.js")).toBe(true);
    expect(isNonHtmlUrl("https://example.test/data/feed.json")).toBe(true);
  });

  it("filters WebDAV HTML document exports", () => {
    expect(
      isNonHtmlUrl(
        "https://example.test/webdav/files/DOKUMENT/oversiktsplan/Hallbarhetsbedomning.htm",
      ),
    ).toBe(true);
    expect(isNonHtmlUrl("https://example.test/webdav/files/archive/report.html")).toBe(true);
    expect(isNonHtmlUrl("https://example.test/regular/page.html")).toBe(false);
  });
});
