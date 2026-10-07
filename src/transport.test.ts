import { afterEach, beforeEach, expect, it, vi } from "vitest";
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { Fetcher } from "./Fetcher";

let server: http.Server;
let lookup: ReturnType<typeof vi.spyOn>;
let addresses: string[];
beforeEach(async () => {
  addresses = [];
  server = http.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  lookup = vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
  const connect = net.connect;
  // Route approved socket destinations to an isolated fixture server. Record
  // the connector's actual lookup results before substituting loopback.
  vi.spyOn(net, "connect").mockImplementation(((options: any) => connect({
    ...options, port,
    lookup(host: string, opts: any, callback: any) {
      options.lookup(host, opts, (error: Error | null, result: any, family: number) => {
        if (error) return callback(error);
        if (Array.isArray(result)) {
          addresses.push(...result.map((r: any) => r.address));
          callback(null, [{ address: "127.0.0.1", family: 4 }]);
        } else {
          addresses.push(result);
          callback(null, "127.0.0.1", family);
        }
      });
    },
  })) as any);
});
afterEach(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

it("connects using the validated DNS result without a rebinding lookup", async () => {
  lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as any)
    .mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as any);
  server.on("request", (req, res) => { res.end(req.headers.host); });
  const result = await Fetcher.html({ url: "http://example.com/" });
  expect(result).toEqual({ isError: false, content: [{ type: "text", text: "example.com" }] });
  expect(addresses).toEqual(["93.184.216.34"]);
  expect(lookup).toHaveBeenCalledTimes(1);
});

it("enforces the byte cap on decompressed data", async () => {
  const compressed = gzipSync(Buffer.alloc(11 * 1024 * 1024, "x"));
  server.on("request", (_req, res) => {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": compressed.length });
    res.end(compressed);
  });
  const result = await Fetcher.html({ url: "http://example.com/" });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("Response too large");
});

it("aborts a stalled body and releases the connection", async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(100));
  let closed = false;
  server.on("request", (_req, res) => {
    res.on("close", () => { closed = true; });
    res.writeHead(200);
    res.write("partial");
  });
  const result = await Fetcher.html({ url: "http://example.com/" });
  expect(result.isError).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(closed).toBe(true);
});

it("bounds outstanding requests and times out stalled DNS", async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(50));
  lookup.mockImplementation(() => new Promise(() => {}));
  const pending = Array.from({ length: 8 }, () => Fetcher.html({ url: "http://example.com/" }));
  const extra = await Fetcher.html({ url: "http://example.com/" });
  expect(extra.content[0].text).toContain("Too many concurrent");
  expect((await Promise.all(pending)).every(result => result.isError)).toBe(true);
  expect(addresses).toEqual([]);
});
