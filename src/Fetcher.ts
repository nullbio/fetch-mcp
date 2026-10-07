import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { fetchText } from "./SafeFetch.js";
import { RequestPayload, YouTubeTranscriptPayload, downloadLimit } from "./types.js";
import { YouTubeTranscript } from "./YouTubeTranscript.js";

export class Fetcher {
  private static applyLengthLimits(text: string, maxLength: number, startIndex: number): string {
    if (startIndex >= text.length) {
      return "";
    }

    const end = maxLength > 0 ? Math.min(startIndex + maxLength, text.length) : text.length;
    return text.substring(startIndex, end);
  }

  static async html(requestPayload: RequestPayload) {
    try {
      let html = await fetchText(requestPayload);
      
      // Apply length limits
      html = this.applyLengthLimits(
        html, 
        requestPayload.max_length ?? downloadLimit,
        requestPayload.start_index ?? 0
      );

      return { content: [{ type: "text", text: html }], isError: false };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  static async json(requestPayload: RequestPayload) {
    try {
      const text = await fetchText(requestPayload);
      const json = JSON.parse(text);
      let jsonString = JSON.stringify(json);
      
      // Apply length limits
      jsonString = this.applyLengthLimits(
        jsonString,
        requestPayload.max_length ?? downloadLimit,
        requestPayload.start_index ?? 0
      );

      return {
        content: [{ type: "text", text: jsonString }],
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  static async txt(requestPayload: RequestPayload) {
    try {
      const html = await fetchText(requestPayload);

      const dom = new JSDOM(html);
      const document = dom.window.document;

      const scripts = document.getElementsByTagName("script");
      const styles = document.getElementsByTagName("style");
      Array.from(scripts).forEach((script) => script.remove());
      Array.from(styles).forEach((style) => style.remove());

      const text = document.body.textContent || "";
      let normalizedText = text.replace(/\s+/g, " ").trim();
      
      // Apply length limits
      normalizedText = this.applyLengthLimits(
        normalizedText,
        requestPayload.max_length ?? downloadLimit,
        requestPayload.start_index ?? 0
      );

      return {
        content: [{ type: "text", text: normalizedText }],
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  private static async fetchTranscriptDirect(
    requestPayload: YouTubeTranscriptPayload,
  ): Promise<{ xml: string; lang: string; langName: string }> {
    const pageUrl = new URL(requestPayload.url);
    this.validateYouTubeUrl(pageUrl);
    const html = await fetchText(requestPayload);

    const playerResponse = YouTubeTranscript.extractPlayerResponse(html);
    const tracks = YouTubeTranscript.getCaptionTracks(playerResponse);

    const lang = requestPayload.lang ?? "en";
    const track =
      tracks.find((t: any) => t.languageCode === lang) ?? tracks[0];

    const captionUrl = new URL(track.baseUrl);
    this.validateYouTubeUrl(captionUrl);
    if (captionUrl.pathname !== "/api/timedtext") throw new Error("Invalid YouTube caption URL");
    captionUrl.searchParams.set("fmt", "srv1");
    // Never forward caller credentials to a URL supplied by fetched content.
    const xml = await fetchText({ url: captionUrl.href });
    return {
      xml,
      lang: track.languageCode,
      langName: track.name?.simpleText ?? "Unknown",
    };
  }

  private static validateYouTubeUrl(url: URL): void {
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) {
      throw new Error("Only HTTPS YouTube URLs are allowed");
    }
  }

  static async youtubeTranscript(requestPayload: YouTubeTranscriptPayload) {
    try {
      const lang = requestPayload.lang ?? "en";
      if (!/^[a-zA-Z0-9-]{1,35}$/.test(lang)) throw new Error("Invalid language code");
      const result = await this.fetchTranscriptDirect(requestPayload);

      const lines = YouTubeTranscript.parseTranscriptXml(result.xml);
      const header = `[Transcript language: ${result.lang} — ${result.langName}]\n\n`;
      let transcript = header + lines.join("\n");

      transcript = this.applyLengthLimits(
        transcript,
        requestPayload.max_length ?? downloadLimit,
        requestPayload.start_index ?? 0,
      );

      return { content: [{ type: "text", text: transcript }], isError: false };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  static async readable(requestPayload: RequestPayload) {
    try {
      const html = await fetchText(requestPayload);

      const dom = new JSDOM(html, { url: requestPayload.url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article) {
        throw new Error("Failed to parse readable content from the page");
      }

      const turndownService = new TurndownService();
      let content = turndownService.turndown(article.content ?? "");

      content = this.applyLengthLimits(
        content,
        requestPayload.max_length ?? downloadLimit,
        requestPayload.start_index ?? 0
      );

      return { content: [{ type: "text", text: content }], isError: false };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  static async markdown(requestPayload: RequestPayload) {
    try {
      const html = await fetchText(requestPayload);
      const turndownService = new TurndownService();
      let markdown = turndownService.turndown(html);
      
      // Apply length limits
      markdown = this.applyLengthLimits(
        markdown,
        requestPayload.max_length ?? downloadLimit,
        requestPayload.start_index ?? 0
      );

      return { content: [{ type: "text", text: markdown }], isError: false };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
}
