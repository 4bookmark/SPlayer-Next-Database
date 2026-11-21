// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { closeMediaBridge, parseByteRange, publishMedia } from "./mediaBridge";
afterEach(closeMediaBridge);
describe("临时媒体桥接", () => {
  it("处理完整、后缀和越界字节区间", () => {
    expect(parseByteRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4 });
    expect(parseByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(() => parseByteRange("bytes=20-", 10)).toThrow();
    expect(() => parseByteRange("bytes=0-1,3-4", 10)).toThrow();
  });
  it("真实 HTTP 支持 HEAD/Range，撤销会话后不可读取", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "splayer-media-"));
    try {
      const file = path.join(dir, "fixture.flac");
      await writeFile(file, "0123456789");
      const lease = await publishMedia(file, undefined, "127.0.0.1");
      const head = await fetch(lease.url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe("10");
      expect(head.headers.get("content-type")).toBe("audio/flac");
      const range = await fetch(lease.url, { headers: { Range: "bytes=2-4" } });
      expect(range.status).toBe(206);
      expect(await range.text()).toBe("234");
      expect((await fetch(lease.url, { headers: { Range: "bytes=99-" } })).status).toBe(416);
      lease.revoke();
      expect((await fetch(lease.url)).status).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("撤销会话立即中断已有上游流，而非只阻止后续请求", async () => {
    let upstreamResponse!: http.ServerResponse;
    const upstream = http.createServer((_request, response) => {
      upstreamResponse = response;
      response.writeHead(200, { "Content-Type": "audio/mpeg" });
      response.write("initial-audio");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    try {
      const address = upstream.address() as import("node:net").AddressInfo;
      const lease = await publishMedia(
        `http://127.0.0.1:${address.port}/audio.mp3`,
        undefined,
        "127.0.0.1",
      );
      const response = await fetch(lease.url);
      const reader = response.body!.getReader();
      expect((await reader.read()).done).toBe(false);
      const disconnected = new Promise<void>((resolve) => upstreamResponse.once("close", resolve));
      lease.revoke();
      await expect(reader.read()).rejects.toThrow();
      await disconnected;
      expect((await fetch(lease.url)).status).toBe(404);
    } finally {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
