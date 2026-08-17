import net from "node:net";

export function normalizedOrigin(value?: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(origin: string | undefined, appOrigin: string) {
  const normalized = normalizedOrigin(origin);
  if (!normalized) return false;
  return normalized === normalizedOrigin(appOrigin);
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

function isPrivateIpv6(hostname: string) {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
}

export function isSafePushEndpoint(value: string) {
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return false;
    if (endpoint.port && endpoint.port !== "443") return false;
    const hostname = endpoint.hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
    const ipVersion = net.isIP(hostname.replace(/^\[|\]$/g, ""));
    if (ipVersion === 4 && isPrivateIpv4(hostname)) return false;
    if (ipVersion === 6 && isPrivateIpv6(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
