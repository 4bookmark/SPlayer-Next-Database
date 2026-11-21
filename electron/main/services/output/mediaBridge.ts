import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { networkInterfaces } from "node:os";
import dgram from "node:dgram";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Track } from "@shared/types/player";

interface Lease {
  source: string;
  mime: string;
  expires: number;
  responses: Set<http.ServerResponse>;
}
const leases = new Map<string, Lease>();
let server: http.Server | undefined;
let starting: Promise<number> | undefined;

/** 撤销会话并终止已建立的数据流，避免设备切换后继续缓冲 */
const revokeLease = (token: string): void => {
  const lease = leases.get(token);
  leases.delete(token);
  for (const response of lease?.responses ?? []) response.destroy();
};

/** 根据真实源格式返回接收端可识别的 MIME */
export const mediaMime = (source: string, track?: Track): string => {
  const extension = (
    track?.quality?.codec || path.extname(source.split("?")[0] ?? "").slice(1)
  ).toLowerCase();
  return (
    (
      {
        mp3: "audio/mpeg",
        flac: "audio/flac",
        wav: "audio/wav",
        m4a: "audio/mp4",
        aac: "audio/aac",
        alac: "audio/mp4",
        ogg: "audio/ogg",
        opus: "audio/ogg",
        aiff: "audio/aiff",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
};

/** 按目标路由获取本机可达地址，不向目标发送 UDP 数据 */
const localAddress = async (target?: string): Promise<string> => {
  if (target) {
    const socket = dgram.createSocket("udp4");
    try {
      return await new Promise<string>((resolve, reject) => {
        socket.once("error", reject);
        socket.connect(9, target, () => resolve(socket.address().address));
      });
    } catch {
      /* 目标暂时无路由时使用活动网卡 */
    } finally {
      socket.close();
    }
  }
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address;
  if (!address) throw new Error("没有可供播放设备访问的局域网地址");
  return address;
};

/** 校验单区间请求，拒绝越界与多区间 */
export const parseByteRange = (
  range: string | undefined,
  size: number,
): { start: number; end: number } | null => {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) throw new Error("range");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    throw new Error("range");
  return { start, end };
};

/** 仅凭随机会话地址流式提供当前获准播放的音源 */
const serve = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> => {
  const token = request.url?.split("/")[2] ?? "";
  const lease = leases.get(token);
  if (!lease || lease.expires < Date.now()) {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end();
    return;
  }
  const abort = new AbortController();
  lease.responses.add(response);
  response.once("close", () => {
    abort.abort();
    lease.responses.delete(response);
  });
  try {
    if (/^https?:\/\//i.test(lease.source)) {
      const upstream = await fetch(lease.source, {
        method: request.method,
        headers: request.headers.range ? { Range: request.headers.range } : {},
        signal: abort.signal,
      });
      if (!upstream.ok) {
        response.writeHead(upstream.status).end();
        return;
      }
      for (const key of ["content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(key);
        if (value) response.setHeader(key, value);
      }
      response.setHeader(
        "Content-Type",
        lease.mime !== "application/octet-stream"
          ? lease.mime
          : (upstream.headers.get("content-type") ?? lease.mime),
      );
      response.writeHead(upstream.status);
      if (request.method === "HEAD" || !upstream.body) {
        await upstream.body?.cancel();
        response.end();
      } else
        await pipeline(
          Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream),
          response,
        );
    } else {
      const info = await stat(lease.source);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      let range: { start: number; end: number } | null;
      try {
        range = parseByteRange(request.headers.range, info.size);
      } catch {
        response.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
        return;
      }
      response.setHeader("Content-Type", lease.mime);
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Length", range ? range.end - range.start + 1 : info.size);
      if (range)
        response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
      response.writeHead(range ? 206 : 200);
      if (request.method === "HEAD") response.end();
      else await pipeline(createReadStream(lease.source, range ?? {}), response);
    }
  } catch {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  }
};

/** 懒启动临时音源服务，并合并并发启动请求 */
const start = (): Promise<number> => {
  if (starting) return starting;
  starting = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      void serve(req, res);
    });
    server.once("error", (error) => {
      starting = undefined;
      reject(error);
    });
    server.listen(0, "0.0.0.0", () => {
      const address = server!.address();
      if (!address || typeof address === "string") {
        reject(new Error("音源服务启动失败"));
        return;
      }
      resolve(address.port);
    });
  });
  return starting;
};

/** 为一个播放会话签发临时媒体地址，不暴露上游鉴权信息 */
export const publishMedia = async (source: string, track?: Track, targetAddress?: string) => {
  if (!/^https?:\/\//i.test(source) && !path.isAbsolute(source))
    throw new Error("音源尚未解析为可播放的地址");
  const [port, address] = await Promise.all([start(), localAddress(targetAddress)]);
  const token = randomBytes(24).toString("hex");
  const mime = mediaMime(source, track);
  for (const [key, lease] of leases) if (lease.expires < Date.now()) revokeLease(key);
  while (leases.size >= 8) revokeLease(leases.keys().next().value!);
  leases.set(token, {
    source,
    mime,
    expires: Date.now() + 24 * 60 * 60 * 1000,
    responses: new Set(),
  });
  const suffix =
    (
      {
        "audio/mpeg": "mp3",
        "audio/flac": "flac",
        "audio/wav": "wav",
        "audio/mp4": "m4a",
        "audio/aac": "aac",
        "audio/ogg": "ogg",
      } as Record<string, string>
    )[mime] ?? "bin";
  return {
    url: `http://${address}:${port}/media/${token}/audio.${suffix}`,
    revoke: () => {
      revokeLease(token);
    },
  };
};

/** 退出时回收音源会话和服务器监听 */
export const closeMediaBridge = (): void => {
  leases.clear();
  server?.close();
  server?.closeAllConnections();
  server = undefined;
  starting = undefined;
};
