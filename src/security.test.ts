import { afterEach, beforeEach, expect, it, vi } from "vitest";
const spyOn = vi.spyOn;
const mock = vi.fn;
import undici from "undici";
import dns from "node:dns";
import { Fetcher } from "./Fetcher";

const originalFetch = undici.fetch;
let lookup: ReturnType<typeof spyOn>;
let request: ReturnType<typeof mock>;
beforeEach(() => {
  lookup = spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
  request = mock();
  undici.fetch = request as any;

});
afterEach(() => {
  undici.fetch = originalFetch;
  lookup.mockRestore();
});

it("blocks a private redirect before sending a second request", async () => {
  request.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
  const result = await Fetcher.html({ url: "https://example.com" });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("private");
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1].redirect).toBe("manual");
});

it("fails closed on DNS failure", async () => {
  lookup.mockRejectedValue(new Error("DNS unavailable"));
  request.mockResolvedValue(new Response("secret"));
  expect((await Fetcher.html({ url: "https://example.com" })).isError).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it("rejects URL credentials and host overrides before network access", async () => {
  request.mockResolvedValue(new Response("secret"));
  for (const payload of [
    { url: "https://user:password@example.com" },
    { url: "https://example.com", headers: { Host: "internal.local" } },
  ]) {
    expect((await Fetcher.html(payload)).isError).toBe(true);
  }
  expect(request).not.toHaveBeenCalled();
});

it("does not forward custom credentials across redirect origins", async () => {
  request.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example.com" } }))
    .mockResolvedValueOnce(new Response("ok"));
  const result = await Fetcher.html({ url: "https://example.com", headers: { "X-Api-Key": "secret" } });
  expect(result.isError).toBe(false);
  expect(new Headers(request.mock.calls[1][1].headers).has("X-Api-Key")).toBe(false);
});

it("rejects caption URLs outside YouTube before forwarding credentials", async () => {
  const player = { captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl: "https://attacker.example/collect", languageCode: "en" },
  ] } } };
  request.mockResolvedValueOnce(new Response(`ytInitialPlayerResponse = ${JSON.stringify(player)};`))
    .mockResolvedValueOnce(new Response("<transcript/>"));
  const result = await Fetcher.youtubeTranscript({ url: "https://www.youtube.com/watch?v=test", headers: { Authorization: "secret" } });
  expect(result.isError).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});

it("blocks non-public IP forms and non-HTTP protocols without network access", async () => {
  for (const url of [
    "file:///etc/passwd", "data:text/plain,secret", "ftp://example.com",
    "http://127.1", "http://2130706433", "http://0x7f000001", "http://localhost.",
    "http://169.254.169.254", "http://10.0.0.1", "http://224.0.0.1",
    "http://100.64.0.1", "http://[::1]", "http://[::ffff:127.0.0.1]",
    "http://[64:ff9b::7f00:1]", "http://[2002:7f00:1::]", "http://[ff02::1]",
  ]) {
    expect((await Fetcher.html({ url })).isError).toBe(true);
  }
  expect(request).not.toHaveBeenCalled();
});

it("rejects DNS answers containing any private address", async () => {
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }] as any);
  expect((await Fetcher.html({ url: "https://example.com" })).isError).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it("revalidates DNS on redirects and blocks HTTPS downgrades", async () => {
  lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as any)
    .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }] as any);
  request.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example.com" } }));
  expect((await Fetcher.html({ url: "https://example.com" })).isError).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://example.com" } }));
  expect((await Fetcher.html({ url: "https://example.com" })).isError).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
});

it("limits redirect loops while allowing relative same-origin redirects", async () => {
  request.mockImplementation(() => Promise.resolve(new Response(null, { status: 302, headers: { location: "/loop" } })));
  const result = await Fetcher.html({ url: "https://example.com" });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("Too many redirects");
  expect(request).toHaveBeenCalledTimes(6);
});

it("caps streamed bodies even without Content-Length and cancels the reader", async () => {
  const cancel = mock();
  request.mockResolvedValueOnce(new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel,
  })));
  const result = await Fetcher.html({ url: "https://example.com", max_length: 1 });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("Response too large");
  expect(cancel).toHaveBeenCalled();
});

it("rejects oversized Content-Length before consuming a body", async () => {
  request.mockResolvedValueOnce(new Response("small", { headers: { "content-length": "99999999999" } }));
  expect((await Fetcher.html({ url: "https://example.com" })).isError).toBe(true);
});
