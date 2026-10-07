import dns from "node:dns";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import undici, { Agent } from "undici";
import { maxResponseBytes, requestTimeoutMs, type RequestPayload } from "./types.js";

const redirects = new Set([301, 302, 303, 307, 308]);
const forbiddenHeaders = new Set([
  "host", "connection", "content-length", "transfer-encoding", "upgrade",
  "proxy-authorization", "proxy-connection", "te", "trailer", "keep-alive",
]);
let activeRequests = 0;

function assertPublic(address: string): void {
  // Only ordinary public unicast: reject mapped/transition IPv6, multicast,
  // loopback, link-local, reserved and private ranges.
  if (!ipaddr.isValid(address) || ipaddr.parse(address).range() !== "unicast") {
    throw new Error("Fetcher blocked private or reserved address");
  }
}

function validateUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Fetcher blocked URL with disallowed protocol "${url.protocol}"`);
  }
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname.replace(/\.$/, "") === "localhost") throw new Error("Fetcher blocked private address");
  if (isIP(hostname)) assertPublic(hostname);
  return url;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** All requests, redirects and decompressed bodies share one deadline. */
export async function fetchText(payload: RequestPayload): Promise<string> {
  if (activeRequests >= 8) throw new Error("Too many concurrent fetch requests");
  activeRequests++;
  const signal = AbortSignal.timeout(requestTimeoutMs);
  try {
    let url = validateUrl(payload.url);
    let headers = new Headers(payload.headers);
    for (const name of headers.keys()) {
      if (forbiddenHeaders.has(name)) throw new Error(`Request header ${name} is not allowed`);
    }
    for (let hop = 0; ; hop++) {
      signal.throwIfAborted();
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await abortable(dns.promises.lookup(hostname, { all: true }), signal);
      if (addresses.length === 0) throw new Error("DNS returned no addresses");
      for (const { address } of addresses) assertPublic(address);
      // The connector receives only these validated addresses, never a second
      // DNS resolution. The original hostname still controls Host and TLS SNI.
      const dispatcher = new Agent({
        connect: {
          lookup: (_hostname, options, callback) => {
            const selected = addresses.filter(a => !options.family || a.family === options.family);
            if (!selected.length) return callback(new Error("No validated address for family"), "", 0);
            if (options.all) callback(null, selected);
            else callback(null, selected[0].address, selected[0].family);
          },
        },
      });
      try {
        const response = await undici.fetch(url.href, {
          headers: { "user-agent": "nullbio-fetch-mcp", ...Object.fromEntries(headers) },
          redirect: "manual", dispatcher, signal,
        });
        if (redirects.has(response.status)) {
          await response.body?.cancel();
          if (hop >= 5) throw new Error("Too many redirects");
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirect has no Location header");
          const next = validateUrl(new URL(location, url).href);
          if (url.protocol === "https:" && next.protocol !== "https:") throw new Error("HTTPS downgrade redirect blocked");
          // Custom headers can contain arbitrary secrets, not just Authorization.
          if (next.origin !== url.origin) headers = new Headers();
          url = next;
          continue;
        }
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        if (Number(response.headers.get("content-length")) > maxResponseBytes) throw new Error("Response too large");
        if (!response.body) return "";
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        let text = "";
        try {
          while (true) {
            const { done, value } = await abortable(reader.read(), signal);
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxResponseBytes) throw new Error("Response too large");
            text += decoder.decode(value, { stream: true });
          }
          return text + decoder.decode();
        } finally {
          await reader.cancel().catch(() => {});
        }
      } finally {
        await dispatcher.destroy();
      }
    }
  } finally {
    activeRequests--;
  }
}
