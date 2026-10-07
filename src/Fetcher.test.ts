import { afterEach, beforeEach, expect, it, vi } from "vitest";
const spyOn = vi.spyOn;
const mock = vi.fn;
import dns from "node:dns";
import undici from "undici";
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

it("parses JSON and paginates the serialized result", async () => {
  request.mockResolvedValueOnce(new Response('{ "value": 42 }'));
  const result = await Fetcher.json({ url: "https://example.com", start_index: 1, max_length: 7 });
  expect(result).toEqual({ content: [{ type: "text", text: '"value"' }], isError: false });
});

it("returns invalid JSON as a tool error", async () => {
  request.mockResolvedValueOnce(new Response("not JSON"));
  expect((await Fetcher.json({ url: "https://example.com" })).isError).toBe(true);
});

it("reports HTTP and network failures for every format", async () => {
  for (const method of ["html", "json", "txt", "markdown", "readable"] as const) {
    request.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    expect((await Fetcher[method]({ url: "https://example.com" })).isError).toBe(true);
    request.mockRejectedValueOnce(new Error("Network error"));
    expect((await Fetcher[method]({ url: "https://example.com" })).isError).toBe(true);
  }
});

it("reports missing captions and invalid language codes", async () => {
  request.mockResolvedValueOnce(new Response('ytInitialPlayerResponse = {"videoDetails":{}};'));
  const result = await Fetcher.youtubeTranscript({ url: "https://www.youtube.com/watch?v=test" });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("No caption tracks");
  const invalid = await Fetcher.youtubeTranscript({ url: "https://www.youtube.com/watch?v=test", lang: "$(whoami)" });
  expect(invalid.isError).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});
