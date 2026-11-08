// Where the authoritative server lives for the static pages. A page served by a
// town server uses its own origin; a page hosted elsewhere (portal, gh-pages)
// takes ?server=https://... . Only http(s) origins are accepted.
export function serverBase(): string {
  const raw = new URLSearchParams(location.search).get("server");
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // fall through to the page origin
    }
  }
  return location.origin;
}
