// A-17: CMS server-side sanitizer must treat URL attributes like a browser (entities decoded, control chars dropped).
import assert from "assert";
import { sanitizePlainContent } from "../services/contentHelpers.js";

const hrefOf = (html) => /href="([^"]*)"/.exec(sanitizePlainContent(html))?.[1];
for (const bad of [
  '<a href="javascript:alert(1)">x</a>', '<a href="java&#x73;cript:alert(1)">x</a>', '<a href="java&#115;cript:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>', '<a href="&#106;avascript&colon;alert(1)">x</a>', '<a href=" JaVaScRiPt:alert(1)">x</a>',
  '<a href="vbscript:x">x</a>', '<a href="data:text/html,<b>x</b>">x</a>', '<a href="file:///etc/passwd">x</a>',
]) {
  assert.strictEqual(hrefOf(bad), undefined, `blocked: ${bad}`);
  assert(!/javascript|vbscript/i.test(sanitizePlainContent(bad).replace(/&lt;/g, "")) || !/href=/.test(sanitizePlainContent(bad)), bad);
}
for (const good of ['<a href="https://example.com/a?b=1&amp;c=2">x</a>', '<a href="/services/scan">x</a>', '<a href="#top">x</a>', '<a href="mailto:a@b.co">x</a>', '<a href="tel:+911234567890">x</a>', '<a href="relative/page">x</a>']) {
  assert(hrefOf(good) !== undefined, `kept: ${good}`);
}
assert.strictEqual(/src="/.test(sanitizePlainContent('<img src="javascript:alert(1)">')), false);
assert.strictEqual(/src="/.test(sanitizePlainContent('<img src="data:image/svg+xml;base64,AAAA">')), false);
assert.strictEqual(sanitizePlainContent("<scr<script>ipt>alert(1)</scr</script>ipt>").includes("<script"), false);
assert.strictEqual(sanitizePlainContent("<p>Hello <strong>world</strong></p>"), "<p>Hello <strong>world</strong></p>");
console.log("PASS: CMS sanitizer blocks entity/whitespace-obfuscated and non-allow-listed URL schemes, keeps safe links");
