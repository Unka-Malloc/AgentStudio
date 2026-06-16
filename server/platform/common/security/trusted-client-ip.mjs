export function normalizeIpAddress(value = "") {
  const text = String(value || "").trim().replace(/^\[|\]$/g, "");
  return text.startsWith("::ffff:") ? text.slice("::ffff:".length) : text;
}

export function firstForwardedFor(request) {
  return normalizeIpAddress(
    String(request?.headers?.["x-forwarded-for"] || "")
      .split(",")[0]
      .trim()
  );
}

export function isLoopbackAddress(value = "") {
  const address = normalizeIpAddress(value).toLowerCase();
  return address === "localhost" ||
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "0:0:0:0:0:0:0:1" ||
    address.startsWith("127.");
}

export function isTrustedProxyAddress(value = "") {
  const remoteAddress = normalizeIpAddress(value);
  if (isLoopbackAddress(remoteAddress)) {
    return true;
  }
  const trusted = String(process.env.PACT_TRUSTED_PROXIES || "")
    .split(",")
    .map((item) => normalizeIpAddress(item))
    .filter(Boolean);
  return trusted.includes(remoteAddress);
}

export function clientIpFromRequest(request, { unknown = "" } = {}) {
  const remoteAddress = normalizeIpAddress(
    request?.socket?.remoteAddress ||
      request?.connection?.remoteAddress ||
      ""
  );
  if (isTrustedProxyAddress(remoteAddress)) {
    const forwarded = firstForwardedFor(request);
    if (forwarded) {
      return forwarded;
    }
  }
  return remoteAddress || unknown;
}

export function hostnameFromHostHeader(value = "") {
  const host = String(value || "").trim().toLowerCase();
  if (!host) {
    return "";
  }
  if (host.startsWith("[")) {
    const closing = host.indexOf("]");
    return closing > 0 ? host.slice(1, closing) : "";
  }
  const colon = host.indexOf(":");
  return colon >= 0 ? host.slice(0, colon) : host;
}

export function isLocalHttpHost(value = "") {
  return isLoopbackAddress(hostnameFromHostHeader(value));
}

export function originHost(value = "") {
  try {
    return new URL(String(value || "")).host.toLowerCase();
  } catch {
    return "";
  }
}

export function isLocalHttpOrigin(value = "") {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && isLoopbackAddress(url.hostname);
  } catch {
    return false;
  }
}
