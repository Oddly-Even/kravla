// SPDX-License-Identifier: MIT
import type { CheerioAPI } from "cheerio";

export type FileLink = {
  url: string;
  anchorText: string;
  mimeType: string;
};

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

export const FILE_EXCLUDE_GLOBS = [
  ...Object.keys(EXTENSION_TO_MIME).map((ext) => `**/*${ext}`),
  "**/webdav/files/**/*.htm",
  "**/webdav/files/**/*.html",
];

const NON_HTML_EXTENSIONS = new Set([
  ...Object.keys(EXTENSION_TO_MIME),
  // Images
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jfif",
  ".jpeg",
  ".jpg",
  ".png",
  ".psd",
  ".svg",
  ".tif",
  ".tiff",
  ".webp",
  // Video
  ".avi",
  ".flv",
  ".mkv",
  ".mov",
  ".mp4",
  ".webm",
  ".wmv",
  // Audio
  ".aac",
  ".flac",
  ".mp3",
  ".ogg",
  ".wav",
  ".wma",
  // Archives
  ".7z",
  ".bz2",
  ".gz",
  ".rar",
  ".tar",
  ".zip",
  // Data / config
  ".csv",
  ".json",
  ".tsv",
  ".xml",
  // Scripts / stylesheets
  ".css",
  ".js",
  ".mjs",
  // Documents (beyond EXTENSION_TO_MIME)
  ".odp",
  ".ods",
  ".odt",
  ".ppt",
  ".pptx",
  ".rtf",
  ".xls",
  ".xlsx",
  // Fonts
  ".eot",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
  // Binaries
  ".deb",
  ".dmg",
  ".exe",
  ".iso",
  ".msi",
  ".rpm",
  // Web manifests / service-worker assets
  ".webmanifest",
]);

/**
 * Build a `FileLink` for a single URL when its extension maps to a
 * supported document type (PDF/DOCX/TXT/MD), else null. Used by the feed
 * runner to route an entry's non-HTML link target through the same
 * crawled-file ingest path as web crawls.
 */
export function fileLinkForUrl(url: string, anchorText?: string): FileLink | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  const ext = pathname.match(/\.[a-z0-9]+$/)?.[0];
  if (!ext) return null;
  const mime = EXTENSION_TO_MIME[ext];
  if (!mime) return null;
  return { url, anchorText: anchorText?.trim() || filenameFromUrl(url), mimeType: mime };
}

export function isNonHtmlUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (isWebdavDocumentExportPath(pathname)) return true;
    const ext = pathname.match(/\.[a-z0-9]+$/)?.[0];
    if (!ext) return false;
    return NON_HTML_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function isWebdavDocumentExportPath(pathname: string): boolean {
  return (
    pathname.startsWith("/webdav/files/") &&
    (pathname.endsWith(".htm") || pathname.endsWith(".html"))
  );
}

/**
 * Extract file links from a crawled page. Scoped to same-hostname only —
 * NOT seed-path scoped, because files typically live under a different path
 * hierarchy than the HTML pages (e.g. `/download/`, `/dokument/`, `/media/`).
 */
export function extractFileLinks($: CheerioAPI, pageUrl: string, seedUrl: string): FileLink[] {
  const seen = new Set<string>();
  const links: FileLink[] = [];

  let seedHostname: string;
  try {
    seedHostname = new URL(seedUrl).hostname;
  } catch {
    return links;
  }

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      return;
    }

    if (resolved.hostname !== seedHostname) return;

    resolved.hash = "";

    const pathname = resolved.pathname.toLowerCase();
    const ext = pathname.match(/\.[a-z0-9]+$/)?.[0];
    if (!ext) return;

    const mime = EXTENSION_TO_MIME[ext];
    if (!mime) return;

    const normalized = resolved.href;
    if (seen.has(normalized)) return;

    seen.add(normalized);
    links.push({
      url: normalized,
      anchorText: filenameFromUrl(normalized),
      mimeType: mime,
    });
  });

  return links;
}

function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (!last) return url;
    const decoded = decodeURIComponent(last);
    return decoded.replace(/\.[^.]+$/, "");
  } catch {
    return url;
  }
}
