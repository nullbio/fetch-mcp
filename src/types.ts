import { z } from "zod";

function envInteger(name: string, fallback: number, minimum: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > 2147483647) {
    throw new Error(`${name} must be an integer between ${minimum} and 2147483647`);
  }
  return parsed;
}

export const downloadLimit = envInteger("DEFAULT_LIMIT", 5000, 0);
export const maxResponseBytes = envInteger("MAX_RESPONSE_BYTES", 10485760, 1);
export const requestTimeoutMs = envInteger("REQUEST_TIMEOUT_MS", 30000, 1);

export const RequestPayloadSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  max_length: z.number().int().min(0).optional().default(downloadLimit),
  start_index: z.number().int().min(0).optional().default(0),
}).strict();

export type RequestPayload = z.input<typeof RequestPayloadSchema>;
export const YouTubeTranscriptPayloadSchema = RequestPayloadSchema.extend({
  lang: z.string().regex(/^[a-zA-Z0-9-]{1,35}$/).optional().default("en"),
});
export type YouTubeTranscriptPayload = z.input<typeof YouTubeTranscriptPayloadSchema>;
