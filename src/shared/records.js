export function nowIso() {
  return new Date().toISOString();
}

/* node:coverage disable */
export function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined)
  );
}

export function safeText(value, fallback = "") {
  const output = String(value ?? "").trim();
  return output || fallback;
}

export function safeToken(value, fallback = "default") {
  const token = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
  return token && token !== "." && token !== ".." ? token : fallback;
}
/* node:coverage enable */
