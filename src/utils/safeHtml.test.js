import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./safeHtml";

describe("sanitizeHtml", () => {
  it("keeps normal article formatting", () => {
    const out = sanitizeHtml('<h2>Title</h2><p>Hello <strong>world</strong> <a href="https://example.com">link</a></p><ul><li>a</li></ul>');
    expect(out).toContain("<h2>Title</h2>"); expect(out).toContain("<strong>world</strong>"); expect(out).toContain('href="https://example.com"'); expect(out).toContain("<li>a</li>");
  });
  it("removes scripts, event handlers, javascript: URLs, iframes, forms and styles", () => {
    const evil = '<p onclick="steal()">x</p><script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">c</a><iframe src="https://evil"></iframe><form action="/x"><input></form><style>*{display:none}</style>';
    const out = sanitizeHtml(evil);
    for (const bad of ["<script", "onclick", "onerror", "javascript:", "<iframe", "<form", "<input", "<style"]) expect(out.toLowerCase()).not.toContain(bad);
    expect(out).toContain("<p>x</p>");
  });
  it("opens external links in a new tab with rel=noopener, leaves internal links alone", () => {
    const out = sanitizeHtml('<a href="https://a.test">x</a><a href="/services">y</a>');
    expect(out).toContain('target="_blank"'); expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('<a href="/services">y</a>');
  });
  it("is safe for null, undefined and non-strings", () => {
    expect(sanitizeHtml(null)).toBe(""); expect(sanitizeHtml(undefined)).toBe(""); expect(sanitizeHtml(42)).toBe("42");
  });
});
