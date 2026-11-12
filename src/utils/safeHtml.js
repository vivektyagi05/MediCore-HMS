import DOMPurify from "dompurify";

// Article/CMS bodies are rich HTML written by admins and rendered on PUBLIC pages. Never inject them raw: a compromised
// admin account or a pasted snippet would become stored XSS for every visitor. Allow ordinary formatting only.
const CONFIG = {
  ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "u", "s", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "hr", "span", "div", "code", "pre", "figure", "figcaption"],
  ALLOWED_ATTR: ["href", "src", "alt", "title", "target", "rel", "colspan", "rowspan", "class"],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
};

let hooked = false;
const ensureHook = () => {
  if (hooked) return;
  hooked = true;
  // DOMPurify drops author-supplied `target`; we decide ourselves: external links open in a new tab and never receive
  // the opener (no reverse-tabnabbing); internal/relative links are left alone.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && /^https?:/i.test(node.getAttribute("href") || "")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
};

export const sanitizeHtml = (html) => {
  ensureHook();
  return DOMPurify.sanitize(String(html ?? ""), CONFIG);
};
