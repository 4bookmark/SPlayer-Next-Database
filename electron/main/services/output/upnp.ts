import { XMLParser } from "fast-xml-parser";
import { fetchLan } from "./lanRequest";
import type { Track } from "@shared/types/player";
import type {
  OutputTarget,
  OutputStatusListener,
  RemoteOutputBackend,
  OutputPlaybackStatus,
} from "@shared/types/output";

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
});
const AV = "urn:schemas-upnp-org:service:AVTransport:1";
const RC = "urn:schemas-upnp-org:service:RenderingControl:1";

/** 将文本编码为 XML 内容，避免媒体元数据破坏 SOAP 请求
 * @param value - 原始文本
 * @returns XML 安全文本
 */
export function escapeXml(value: unknown): string {
  return String(value ?? "").replace(
    /[<>&"']/g,
    (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!,
  );
}

/** 从曲目信息推断远程设备需要的 MIME 类型
 * @param track - 当前曲目
 * @param url - 媒体地址
 * @returns 音频 MIME 类型
 */
export function mediaContentType(track: Track | undefined, url: string): string {
  const codec = track?.quality?.codec?.toLowerCase() ?? "";
  const extension =
    (track?.cueAudioPath ?? track?.path ?? new URL(url).pathname).split(".").pop()?.toLowerCase() ??
    "";
  const types: Record<string, string> = {
    mp3: "audio/mpeg",
    mp2: "audio/mpeg",
    flac: "audio/flac",
    aac: "audio/aac",
    m4a: "audio/mp4",
    alac: "audio/mp4",
    mp4: "audio/mp4",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    vorbis: "audio/ogg",
    wav: "audio/wav",
    wave: "audio/wav",
    aiff: "audio/aiff",
    aif: "audio/aiff",
    wma: "audio/x-ms-wma",
  };
  return (
    types[extension] ?? types[codec] ?? (codec.startsWith("pcm_") ? "audio/wav" : "audio/mpeg")
  );
}

/** 读取有大小和时间上限的设备 XML
 * @param url - 设备地址
 * @param signal - 取消信号
 * @param init - HTTP 请求参数
 * @returns 解析后的 XML
 */
export async function readDeviceXml(
  url: string,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<Record<string, any>> {
  const response = await fetchLan(url, { ...init, signal });
  if (!response.body) throw new Error("Empty UPnP response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 512 * 1024) throw new Error("UPnP response exceeds size limit");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const xml = parser.parse(Buffer.concat(chunks).toString("utf8"));
  if (!response.ok || xml.Envelope?.Body?.Fault)
    throw new Error(`UPnP request failed (${response.status})`);
  return xml;
}

/** 调用标准 SOAP 动作
 * @param url - 服务控制地址
 * @param service - UPnP 服务类型
 * @param action - 动作名称
 * @param args - 动作参数
 * @param signal - 可选取消信号
 * @returns 动作响应
 */
export async function soap(
  url: string,
  service: string,
  action: string,
  args: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  const body = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}">${Object.entries(
    args,
  )
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join("")}</u:${action}></s:Body></s:Envelope>`;
  const xml = await readDeviceXml(
    url,
    signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"${service}#${action}"`,
      },
      body,
    },
  );
  return xml.Envelope?.Body?.[`${action}Response`] ?? {};
}

/** 解析设备时间为毫秒
 * @param value - HH:MM:SS 时间
 * @returns 毫秒
 */
export function parseUpnpTime(value: string): number {
  const parts = String(value).split(":").map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? Math.max(0, (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000)
    : 0;
}

/** 为设备生成 DIDL 元数据
 * @param url - 媒体地址
 * @param track - 曲目
 * @returns DIDL XML
 */
export function trackMetadata(url: string, track?: Track): string {
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>${escapeXml(track?.title ?? "SPlayer")}</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><upnp:artist>${escapeXml(track?.artists.map((artist) => artist.name).join(", "))}</upnp:artist><upnp:album>${escapeXml(track?.album?.name)}</upnp:album><res protocolInfo="http-get:*:${mediaContentType(track, url)}:*">${escapeXml(url)}</res></item></DIDL-Lite>`;
}

/** 从 Sonos 拓扑解析现有协调器，兼容根包装及家庭影院卫星成员
 * @param topologyXml - GetZoneGroupState 返回的内部 XML
 * @param targetId - 发现的 Sonos 设备标识
 * @returns 协调器设备描述地址
 */
export function resolveSonosCoordinator(topologyXml: string, targetId: string): string {
  const parsed = parser.parse(topologyXml);
  const root = parsed.ZoneGroupState ?? parsed;
  const value = root.ZoneGroups?.ZoneGroup ?? [];
  const groups = Array.isArray(value) ? value : [value];
  const uuid = targetId.replace(/^sonos:/, "").replace(/^uuid:/, "");
  for (const group of groups) {
    const value = group.ZoneGroupMember ?? [];
    const members = Array.isArray(value) ? value : [value];
    const participants = [...members];
    for (let index = 0; index < participants.length; index++) {
      const satellites = participants[index]?.Satellite;
      if (satellites) participants.push(...(Array.isArray(satellites) ? satellites : [satellites]));
    }
    if (!participants.some((member) => member?.["@_UUID"] === uuid)) continue;
    const coordinator = members.find((member) => member?.["@_UUID"] === group["@_Coordinator"]);
    const location = coordinator?.["@_Location"];
    if (typeof location !== "string" || !URL.canParse(location)) break;
    const url = new URL(location);
    if (url.protocol !== "http:" || url.username || url.password) break;
    return url.href;
  }
  throw new Error("无法找到 Sonos 当前分组的主设备，请确认音箱在线后重新扫描");
}

/** 连接渲染器，Sonos 自动使用现有分组协调器
 * @param target - 发现的设备
 * @param onStatus - 播放状态监听
 * @param onError - 连接错误监听
 * @returns UPnP 播放后端
 */
export async function createUpnpBackend(
  target: OutputTarget,
  onStatus: OutputStatusListener,
  onError: (message: string) => void,
): Promise<RemoteOutputBackend> {
  if (!target.controlUrl) throw new Error("Missing UPnP control endpoint");
  let controlUrl = target.controlUrl;
  let renderingUrl = target.renderingUrl;
  const lifetime = new AbortController();
  if (target.protocol === "sonos") {
    const topology = await soap(
      new URL("/ZoneGroupTopology/Control", controlUrl).href,
      "urn:schemas-upnp-org:service:ZoneGroupTopology:1",
      "GetZoneGroupState",
      {},
    );
    const coordinator = resolveSonosCoordinator(topology.ZoneGroupState ?? "", target.id);
    controlUrl = new URL("/MediaRenderer/AVTransport/Control", coordinator).href;
    renderingUrl = new URL("/MediaRenderer/RenderingControl/Control", coordinator).href;
  }
  let closed = false;
  let loadedUrl = "";
  let hadPlaying = false;
  let intentionalStop = false;
  let polling = false;
  let failures = 0;
  let generation = 0;
  const status: OutputPlaybackStatus = {
    state: "idle",
    positionMs: 0,
    durationMs: 0,
    volume: 1,
    external: true,
  };

  /** 执行传输动作
   * @param action - 动作名称
   * @param args - 附加参数
   * @returns 动作响应
   */
  async function transport(
    action: string,
    args: Record<string, string | number> = {},
  ): Promise<Record<string, any>> {
    if (closed) throw new Error("UPnP connection closed");
    return soap(controlUrl, AV, action, { InstanceID: 0, ...args }, lifetime.signal);
  }
  let sequence = Promise.resolve();
  let mutating = false;
  /** 串行化设备写入，确保旧请求不会在新装载后覆盖设备状态
   * @param action - 本次设备写入
   * @returns 本次写入完成信号
   */
  function enqueue(action: () => Promise<void>): Promise<void> {
    const next = sequence.then(async () => {
      if (closed) throw new Error("UPnP connection closed");
      mutating = true;
      try {
        await action();
      } finally {
        mutating = false;
      }
    });
    sequence = next.catch(() => {});
    return next;
  }
  /** 在当前写入序列中设置毫秒进度
   * @param positionMs - 目标进度
   */
  async function seekTransport(positionMs: number): Promise<void> {
    const seconds = Math.max(0, Math.floor(positionMs / 1000));
    const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
    await transport("Seek", { Unit: "REL_TIME", Target: time });
    previousPosition = positionMs;
  }
  /** 更新当前播放状态，检测外部换曲和自然结束 */
  async function poll(): Promise<void> {
    if (closed || polling || mutating) return;
    polling = true;
    const version = generation;
    try {
      const [info, position, volume] = await Promise.all([
        transport("GetTransportInfo"),
        transport("GetPositionInfo"),
        renderingUrl
          ? soap(
              renderingUrl,
              RC,
              "GetVolume",
              { InstanceID: 0, Channel: "Master" },
              lifetime.signal,
            ).catch(() => undefined)
          : undefined,
      ]);
      if (closed || generation !== version) return;
      failures = 0;
      const wasPlaying = hadPlaying;
      status.state =
        info.CurrentTransportState === "PLAYING"
          ? "playing"
          : info.CurrentTransportState === "PAUSED_PLAYBACK"
            ? "paused"
            : info.CurrentTransportState === "TRANSITIONING"
              ? "loading"
              : "stopped";
      status.positionMs = parseUpnpTime(position.RelTime);
      status.durationMs = parseUpnpTime(position.TrackDuration) || status.durationMs;
      if (volume && Number.isFinite(Number(volume.CurrentVolume)))
        status.volume = Math.min(1, Math.max(0, Number(volume.CurrentVolume) / 100));
      const ownTrack = !!loadedUrl && (!position.TrackURI || position.TrackURI === loadedUrl);
      if (!ownTrack) hadPlaying = false;
      if (status.state === "playing" && ownTrack) hadPlaying = true;
      const finished =
        ownTrack &&
        wasPlaying &&
        !intentionalStop &&
        status.state === "stopped" &&
        status.durationMs > 0 &&
        previousPosition >= status.durationMs - 2500;
      previousPosition = status.positionMs;
      if (finished) hadPlaying = false;
      onStatus({ ...status, finished });
    } catch (error) {
      if (!closed && ++failures >= 3) {
        await backend.close();
        onError(error instanceof Error ? error.message : "UPnP connection lost");
      }
    } finally {
      polling = false;
    }
  }
  let previousPosition = 0;
  await transport("GetTransportInfo");
  const timer = setInterval(() => void poll(), 1000);
  timer.unref();
  const backend: RemoteOutputBackend = {
    /** 装载远程媒体并恢复指定进度
     * @param url - 可由设备访问的媒体地址
     * @param track - 当前曲目
     * @param positionMs - 毫秒进度
     * @param autoPlay - 是否立即播放
     */
    async load(url, track, positionMs, autoPlay) {
      const version = ++generation;
      intentionalStop = true;
      hadPlaying = false;
      await enqueue(async () => {
        if (version !== generation) return;
        await transport("SetAVTransportURI", {
          CurrentURI: url,
          CurrentURIMetaData: trackMetadata(url, track),
        });
        // URI 已在设备端生效，暂停只取消后续自动播放，不撤销媒体归属
        loadedUrl = url;
        status.durationMs = track?.duration ?? 0;
        status.positionMs = 0;
        previousPosition = 0;
        if (version !== generation) return;
        if (positionMs > 0) {
          await seekTransport(positionMs);
          status.positionMs = positionMs;
        }
        if (version !== generation) return;
        if (autoPlay) {
          intentionalStop = false;
          await transport("Play", { Speed: 1 });
        } else status.state = "paused";
        if (version === generation) onStatus({ ...status });
      });
    },
    /** 开始播放当前媒体 */
    async play() {
      const version = generation;
      await enqueue(async () => {
        if (version !== generation) return;
        intentionalStop = false;
        await transport("Play", { Speed: 1 });
      });
    },
    /** 暂停设备播放，并取消尚未完成的自动播放 */
    async pause() {
      generation++;
      intentionalStop = true;
      await enqueue(async () => {
        await transport("Pause");
      });
    },
    /** 停止设备播放并抑制自然结束事件 */
    async stop() {
      generation++;
      intentionalStop = true;
      hadPlaying = false;
      await enqueue(async () => {
        await transport("Stop");
        loadedUrl = "";
      });
    },
    /** 将毫秒进度转换为 UPnP 时间
     * @param positionMs - 目标毫秒进度
     */
    async seek(positionMs) {
      const version = generation;
      await enqueue(async () => {
        if (version === generation) await seekTransport(positionMs);
      });
    },
    /** 更新设备主声道音量
     * @param volume - 零到一的音量
     */
    async setVolume(volume) {
      if (closed) throw new Error("UPnP connection closed");
      if (!renderingUrl) throw new Error("Device does not support volume control");
      await soap(
        renderingUrl,
        RC,
        "SetVolume",
        {
          InstanceID: 0,
          Channel: "Master",
          DesiredVolume: Math.round(Math.max(0, Math.min(1, volume)) * 100),
        },
        lifetime.signal,
      );
    },
    /** 取消轮询并释放未完成请求 */
    async close() {
      if (closed) return;
      closed = true;
      generation++;
      clearInterval(timer);
      lifetime.abort();
    },
  };
  return backend;
}
