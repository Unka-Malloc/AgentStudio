import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

export const SERVICEHUB_EGRESS_DECISION_VERSION = "v0.0.1:external-service:servicehub-egress-decision-1";
export const SERVICEHUB_DEVELOPMENT_LOCAL_POLICY_PRESET = "servicehub.development-local";
export const SERVICEHUB_REDIRECT_DECISION_VERSION = "v0.0.1:external-service:servicehub-redirect-decision-1";

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function normalizeHost(value = "") {
  return String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function normalizeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function ipv4Parts(value = "") {
  const parts = String(value || "").split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function ipv4RangeCategory(address = "") {
  const parts = ipv4Parts(address);
  if (!parts) return "";
  const [a, b] = parts;
  if (a === 0) return "unspecified";
  if (a === 10) return "private";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade-nat";
  if (a === 198 && (b === 18 || b === 19)) return "benchmark";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  return "public";
}

function expandIpv6(address = "") {
  const input = String(address || "").toLowerCase();
  if (!input.includes(":")) {
    return null;
  }
  const [headText, tailText] = input.split("::");
  if (input.split("::").length > 2) {
    return null;
  }
  const head = headText ? headText.split(":").filter(Boolean) : [];
  const tail = tailText ? tailText.split(":").filter(Boolean) : [];
  const expandedTail = [];
  for (const part of tail) {
    if (part.includes(".")) {
      const v4 = ipv4Parts(part);
      if (!v4) return null;
      expandedTail.push(((v4[0] << 8) | v4[1]).toString(16));
      expandedTail.push(((v4[2] << 8) | v4[3]).toString(16));
    } else {
      expandedTail.push(part);
    }
  }
  const missing = 8 - head.length - expandedTail.length;
  if (missing < 0 || (!input.includes("::") && missing !== 0)) {
    return null;
  }
  const parts = [
    ...head,
    ...Array.from({ length: missing }, () => "0"),
    ...expandedTail
  ];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}

function ipv6BigInt(parts = []) {
  return parts.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
}

function ipv6RangeCategory(address = "") {
  const parts = expandIpv6(address);
  if (!parts) return "";
  const value = ipv6BigInt(parts);
  if (value === 0n) return "unspecified";
  if (value === 1n) return "loopback";
  const first = parts[0];
  if ((first & 0xfe00) === 0xfc00) return "private";
  if ((first & 0xffc0) === 0xfe80) return "link-local";
  if ((first & 0xff00) === 0xff00) return "multicast";
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return ipv4RangeCategory(`${parts[6] >> 8}.${parts[6] & 255}.${parts[7] >> 8}.${parts[7] & 255}`);
  }
  return "public";
}

export function classifyExternalServiceHost(host = "") {
  const normalized = normalizeHost(host);
  if (!normalized) {
    return { host: "", kind: "missing", category: "invalid", restricted: true };
  }
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return { host: normalized, kind: "hostname", category: "loopback", restricted: true };
  }
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const category = ipv4RangeCategory(normalized);
    return {
      host: normalized,
      kind: "ipv4",
      category,
      restricted: category !== "public"
    };
  }
  if (ipVersion === 6) {
    const category = ipv6RangeCategory(normalized);
    return {
      host: normalized,
      kind: "ipv6",
      category,
      restricted: category !== "public"
    };
  }
  return {
    host: normalized,
    kind: "hostname",
    category: "hostname",
    restricted: false
  };
}

export function serviceHubLocalEgressAllowed({
  policyPreset = "",
  policies = {}
} = {}) {
  const egress = asObject(asObject(policies).egress);
  return String(policyPreset || "").trim() === SERVICEHUB_DEVELOPMENT_LOCAL_POLICY_PRESET ||
    egress.allowLocalForDevelopment === true ||
    egress.allowLocalForConfiguredModelService === true;
}

export function evaluateExternalServiceEgressUrl({
  url = "",
  policyPreset = "",
  policies = {},
  label = "upstream.url"
} = {}) {
  let parsed;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    return {
      schemaVersion: SERVICEHUB_EGRESS_DECISION_VERSION,
      ok: false,
      label,
      url: String(url || "").trim(),
      reason: "invalid_url"
    };
  }
  const host = classifyExternalServiceHost(parsed.hostname);
  const egress = asObject(asObject(policies).egress);
  const allowLocal = serviceHubLocalEgressAllowed({ policyPreset, policies });
  const blocked = host.restricted && !allowLocal;
  return {
    schemaVersion: SERVICEHUB_EGRESS_DECISION_VERSION,
    ok: !blocked,
    label,
    url: parsed.toString(),
    protocol: parsed.protocol.replace(/:$/, ""),
    host: host.host,
    port: parsed.port,
    hostKind: host.kind,
    addressCategory: host.category,
    allowLocalForDevelopment: allowLocal,
    allowLocalForConfiguredModelService: egress.allowLocalForConfiguredModelService === true,
    reason: blocked ? `restricted_address_${host.category}` : "allowed"
  };
}

export function assertExternalServiceEgressAllowed(options = {}) {
  const decision = evaluateExternalServiceEgressUrl(options);
  if (!decision.ok) {
    const error = new Error(`ServiceHub egress denied for ${decision.label}: ${decision.reason}.`);
    error.code = "servicehub_egress_denied";
    error.decision = decision;
    throw error;
  }
  return decision;
}

function normalizeDnsLookupRecords(records = []) {
  const values = Array.isArray(records) ? records : [records];
  const seen = new Set();
  const normalized = [];
  for (const record of values) {
    const address = String(record?.address || record || "").trim();
    if (!address) {
      continue;
    }
    const family = Number(record?.family || net.isIP(address) || 0);
    const key = `${address}/${family}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const classified = classifyExternalServiceHost(address);
    normalized.push({
      address,
      family,
      hostKind: classified.kind,
      addressCategory: classified.category,
      restricted: classified.restricted
    });
  }
  return normalized;
}

async function defaultDnsLookup(host) {
  return dns.lookup(host, { all: true, verbatim: true });
}

function selectedPinnedDnsAddress(decision = {}) {
  const addresses = Array.isArray(decision?.dns?.addresses) ? decision.dns.addresses : [];
  if (addresses.length === 0) {
    return null;
  }
  return addresses.find((record) => record?.restricted !== true) || addresses[0] || null;
}

function createPinnedDnsDispatcher(decision = {}) {
  const pinned = selectedPinnedDnsAddress(decision);
  if (!pinned?.address) {
    return {
      dispatcher: undefined,
      pinnedDns: null,
      async close() {}
    };
  }
  const expectedHost = normalizeHost(decision.host);
  const address = String(pinned.address || "").trim();
  const family = Number(pinned.family || net.isIP(address) || 0);
  const dispatcher = new Agent({
    connect: {
      lookup(hostname, options = {}, callback) {
        const requestedHost = normalizeHost(hostname);
        if (requestedHost && expectedHost && requestedHost !== expectedHost) {
          callback(new Error(`Pinned DNS lookup rejected unexpected host: ${requestedHost}`));
          return;
        }
        if (options?.all) {
          callback(null, [{ address, family }]);
          return;
        }
        callback(null, address, family);
      }
    }
  });
  return {
    dispatcher,
    pinnedDns: {
      host: expectedHost,
      address,
      family,
      addressCategory: String(pinned.addressCategory || ""),
      restricted: pinned.restricted === true
    },
    async close() {
      await dispatcher.close();
    }
  };
}

export async function evaluateExternalServiceEgressUrlWithDns({
  lookup = defaultDnsLookup,
  ...options
} = {}) {
  const decision = evaluateExternalServiceEgressUrl(options);
  if (!decision.ok) {
    return {
      ...decision,
      dns: {
        status: "skipped",
        reason: "host_decision_denied"
      }
    };
  }
  if (decision.hostKind !== "hostname" || decision.addressCategory !== "hostname") {
    return {
      ...decision,
      dns: {
        status: "skipped",
        reason: "literal_address"
      }
    };
  }
  let records;
  try {
    records = await lookup(decision.host, { all: true, verbatim: true });
  } catch (error) {
    return {
      ...decision,
      ok: false,
      reason: "dns_lookup_failed",
      dns: {
        status: "failed",
        host: decision.host,
        error: normalizeErrorMessage(error)
      }
    };
  }
  const addresses = normalizeDnsLookupRecords(records);
  const restricted = addresses.filter((record) => record.restricted);
  const blocked = restricted.length > 0 && !decision.allowLocalForDevelopment;
  return {
    ...decision,
    ok: !blocked,
    reason: blocked ? `restricted_dns_address_${restricted[0].addressCategory}` : "allowed",
    dns: {
      status: "resolved",
      host: decision.host,
      addresses,
      addressCount: addresses.length,
      restrictedAddressCount: restricted.length
    }
  };
}

export async function assertExternalServiceRuntimeEgressAllowed(options = {}) {
  const decision = await evaluateExternalServiceEgressUrlWithDns(options);
  if (!decision.ok) {
    const error = new Error(`ServiceHub egress denied for ${decision.label}: ${decision.reason}.`);
    error.code = "servicehub_egress_denied";
    error.decision = decision;
    throw error;
  }
  return decision;
}

export async function fetchExternalServiceWithPinnedDns({
  url = "",
  label = "upstream.url",
  policyPreset = "",
  policies = {},
  init = {},
  lookup = defaultDnsLookup,
  fetchImpl = globalThis.fetch
} = {}) {
  const decision = await assertExternalServiceRuntimeEgressAllowed({
    url,
    label,
    policyPreset,
    policies,
    lookup
  });
  const pinned = createPinnedDnsDispatcher(decision);
  try {
    const response = await fetchImpl(url, {
      ...asObject(init),
      ...(pinned.dispatcher ? { dispatcher: pinned.dispatcher } : {})
    });
    return {
      response,
      decision,
      egressDecision: decision,
      pinnedDns: pinned.pinnedDns,
      close: pinned.close
    };
  } catch (error) {
    await pinned.close();
    error.decision = error.decision || decision;
    throw error;
  }
}

function redirectStatus(value) {
  const status = Number(value || 0);
  return Number.isInteger(status) && status >= 300 && status < 400;
}

export function evaluateExternalServiceRedirectLocation({
  sourceUrl = "",
  status = 0,
  location = "",
  policyPreset = "",
  policies = {},
  label = "redirect.location"
} = {}) {
  const normalizedLocation = String(location || "").trim();
  if (!redirectStatus(status)) {
    return {
      schemaVersion: SERVICEHUB_REDIRECT_DECISION_VERSION,
      ok: true,
      status: Number(status || 0),
      sourceUrl: String(sourceUrl || "").trim(),
      location: normalizedLocation,
      reason: "not_redirect"
    };
  }
  if (!normalizedLocation) {
    return {
      schemaVersion: SERVICEHUB_REDIRECT_DECISION_VERSION,
      ok: false,
      status: Number(status || 0),
      sourceUrl: String(sourceUrl || "").trim(),
      location: "",
      reason: "redirect_location_missing"
    };
  }
  let target;
  try {
    target = new URL(normalizedLocation, String(sourceUrl || "").trim());
  } catch {
    return {
      schemaVersion: SERVICEHUB_REDIRECT_DECISION_VERSION,
      ok: false,
      status: Number(status || 0),
      sourceUrl: String(sourceUrl || "").trim(),
      location: normalizedLocation,
      reason: "invalid_redirect_location"
    };
  }
  const targetUrl = target.toString();
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return {
      schemaVersion: SERVICEHUB_REDIRECT_DECISION_VERSION,
      ok: false,
      status: Number(status || 0),
      sourceUrl: String(sourceUrl || "").trim(),
      location: normalizedLocation,
      targetUrl,
      reason: "unsupported_redirect_protocol"
    };
  }
  const targetDecision = evaluateExternalServiceEgressUrl({
    url: targetUrl,
    policyPreset,
    policies,
    label
  });
  return {
    schemaVersion: SERVICEHUB_REDIRECT_DECISION_VERSION,
    ok: targetDecision.ok,
    status: Number(status || 0),
    sourceUrl: String(sourceUrl || "").trim(),
    location: normalizedLocation,
    targetUrl,
    reason: targetDecision.ok ? "redirect_location_allowed" : targetDecision.reason,
    targetDecision
  };
}

export async function evaluateExternalServiceRedirectLocationWithDns({
  lookup = defaultDnsLookup,
  ...options
} = {}) {
  const decision = evaluateExternalServiceRedirectLocation(options);
  if (!decision.ok || !decision.targetUrl) {
    return decision;
  }
  const targetDecision = await evaluateExternalServiceEgressUrlWithDns({
    url: decision.targetUrl,
    policyPreset: options.policyPreset,
    policies: options.policies,
    label: options.label || "redirect.location",
    lookup
  });
  return {
    ...decision,
    ok: targetDecision.ok,
    reason: targetDecision.ok ? "redirect_location_allowed" : targetDecision.reason,
    targetDecision
  };
}
