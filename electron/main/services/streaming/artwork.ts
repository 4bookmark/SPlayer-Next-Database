import { net } from "electron";
import type { Album } from "@shared/types/player";
import type { AlbumArtwork, AlbumArtworkStatus } from "@shared/types/streaming";
import { getAlbumArtworkCover } from "@shared/utils/artistGroups";
import { sendToMain } from "@main/utils/broadcast";
import { hasAlbum } from "@main/database/streaming/albums";
import { getStreamingConfig } from "./config";
import { withStreamingAdapter } from "./connection";
import { getOrganization, setAlbumArtworkChoice } from "./organization";
import { StreamingRequestError } from "./errors";

interface ArtworkAccess {
  revision: number;
  pictures: AlbumArtwork[];
  status: AlbumArtworkStatus;
}

// 仅缓存最近 256 张专辑的元数据，图片通过 HTTP 流式返回
const accessByAlbum = new Map<string, ArtworkAccess>();

/**
 * 获取仍属于当前服务器和曲库的专辑身份
 * @param serverId - 服务器 ID
 * @param albumId - 专辑 ID
 * @returns 当前媒体修订号，专辑不存在时返回 undefined
 */
const albumRevision = (serverId: string, albumId: string): number | undefined => {
  const server = getStreamingConfig().servers.find((item) => item.id === serverId);
  return server && hasAlbum(serverId, albumId) ? (server.mediaRevision ?? 0) : undefined;
};

/**
 * 从 gonic HTTP 枚举专辑当前层的图片，不访问本机文件系统
 * @param serverId - 服务器 ID
 * @param albumId - 原始服务端专辑 ID
 * @returns 不含凭据的主进程图片代理地址
 */
export const getAlbumArtworks = async (
  serverId: string,
  albumId: string,
): Promise<AlbumArtwork[]> => {
  const revision = albumRevision(serverId, albumId);
  if (revision === undefined) return [];
  const key = JSON.stringify([serverId, albumId]);
  const access: ArtworkAccess = {
    revision,
    pictures: [],
    status: { found: 0, unavailable: [] },
  };
  accessByAlbum.delete(key);
  accessByAlbum.set(key, access);
  while (accessByAlbum.size > 256) accessByAlbum.delete(accessByAlbum.keys().next().value!);
  try {
    const pictures = await withStreamingAdapter(
      serverId,
      (config, adapter) =>
        adapter.getAlbumArtworks?.(config, albumId) ?? Promise.resolve(undefined),
    );
    if (albumRevision(serverId, albumId) !== revision || accessByAlbum.get(key) !== access)
      return [];
    if (!pictures) {
      access.status.error = "extension-unavailable";
      return [];
    }
    const choice = getOrganization(serverId).albumArtworkChoices?.[albumId];
    access.pictures = pictures.map((picture) => {
      const params = new URLSearchParams({
        serverId,
        albumId,
        artworkId: picture.id,
        version: picture.version,
        revision: String(revision),
      });
      const original = `streaming-cover://album-artwork?${params.toString()}`;
      return {
        id: picture.id,
        name: picture.name,
        original,
        thumbnail: `${original}&size=300`,
        selected: choice?.source === "gonic-http" && choice.id === picture.id,
      };
    });
    access.status.found = pictures.length;
    if (choice?.source === "gonic-http") {
      const selected = access.pictures.find((picture) => picture.selected);
      // 有界清单可能暂时过滤不可读图片，缺席不代表文件已删除
      if (selected && selected.thumbnail !== choice.thumbnail) {
        setAlbumArtworkChoice(serverId, albumId, { ...choice, thumbnail: selected.thumbnail });
        sendToMain("streaming:libraryUpdated", serverId);
      }
    }
    return access.pictures;
  } catch (error) {
    access.status.error =
      error instanceof StreamingRequestError &&
      (error.status === 401 || error.status === 403 || error.code === 40 || error.code === 50)
        ? "auth-failed"
        : "request-failed";
    return [];
  }
};

/**
 * 获取最近一次 HTTP 图片清单状态，区分缺少扩展与网络故障
 * @param serverId - 服务器 ID
 * @param albumId - 原始专辑 ID
 * @returns 当前身份下的状态
 */
export const getAlbumArtworkStatus = async (
  serverId: string,
  albumId: string,
): Promise<AlbumArtworkStatus> => {
  const access = accessByAlbum.get(JSON.stringify([serverId, albumId]));
  return access && access.revision === albumRevision(serverId, albumId)
    ? { ...access.status, unavailable: [...access.status.unavailable] }
    : { found: 0, unavailable: [], error: "request-failed" };
};

/**
 * 将已确认的 HTTP 封面应用到专辑列表
 * @param serverId - 服务器 ID
 * @param albums - 原始专辑列表
 * @returns 使用统一主封面的列表
 */
export const applyAlbumArtworkChoices = (serverId: string, albums: Album[]): Album[] => {
  const organization = getOrganization(serverId);
  return albums.map((album) => {
    const cover = getAlbumArtworkCover(organization, album.id);
    return cover ? { ...album, cover } : album;
  });
};

/**
 * 重新验证远端清单并保存用户确认的封面
 * @param serverId - 服务器 ID
 * @param albumId - 原始专辑 ID
 * @param artworkId - 不透明图片 ID，空字符串恢复默认
 * @returns 含已选状态的图片清单
 */
export const setAlbumArtwork = async (
  serverId: string,
  albumId: string,
  artworkId: string,
): Promise<AlbumArtwork[]> => {
  const revision = albumRevision(serverId, albumId);
  if (revision === undefined) throw new Error("专辑不属于当前服务器");
  if (typeof artworkId !== "string") throw new Error("图片选择无效");
  if (!artworkId) {
    setAlbumArtworkChoice(serverId, albumId);
    sendToMain("streaming:libraryUpdated", serverId);
    return [];
  }
  const pictures = await getAlbumArtworks(serverId, albumId);
  if (albumRevision(serverId, albumId) !== revision) throw new Error("服务器身份已变化");
  if (artworkId) {
    const picture = pictures.find((item) => item.id === artworkId);
    if (!picture) throw new Error("图片暂时无法访问，请重新加载后选择");
    setAlbumArtworkChoice(serverId, albumId, {
      source: "gonic-http",
      id: picture.id,
      file: picture.id,
      root: "gonic-http",
      thumbnail: picture.thumbnail,
    });
  }
  sendToMain("streaming:libraryUpdated", serverId);
  return pictures.map((picture) => ({ ...picture, selected: picture.id === artworkId }));
};

/**
 * 通过当前服务器鉴权读取原图或 300px 缩略图
 * @param request - 不含凭据的图片协议请求
 * @returns HTTP 图片流或拒绝响应
 */
export const handleArtworkRequest = async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const serverId = url.searchParams.get("serverId");
    const albumId = url.searchParams.get("albumId");
    const artworkId = url.searchParams.get("artworkId");
    const revision = url.searchParams.get("revision");
    if (
      !serverId ||
      !albumId ||
      !artworkId ||
      !/^[a-f0-9]{64}$/.test(artworkId) ||
      revision === null ||
      String(albumRevision(serverId, albumId)) !== revision
    )
      return new Response(null, { status: 404 });
    const size = url.searchParams.has("size") ? 300 : undefined;
    return await withStreamingAdapter(serverId, async (config, adapter) => {
      if (!adapter.getAlbumArtworkUrl) return new Response(null, { status: 404 });
      const source = await adapter.getAlbumArtworkUrl(config, albumId, artworkId, size);
      const response = await net.fetch(source, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      });
      if (String(albumRevision(serverId, albumId)) !== revision) {
        await response.body?.cancel();
        return new Response(null, { status: 404 });
      }
      if (
        !response.ok ||
        !/^image\/(jpeg|png|webp|gif|bmp)(?:;|$)/i.test(
          response.headers.get("content-type") ?? "",
        ) ||
        Number(response.headers.get("content-length")) > 32 * 1024 * 1024
      ) {
        await response.body?.cancel();
        return new Response(null, { status: 502 });
      }
      const headers = new Headers({
        "Content-Type": response.headers.get("content-type")!,
        "Cache-Control": "private, max-age=0, must-revalidate",
      });
      let bytes = 0;
      const body = response.body?.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > 32 * 1024 * 1024) {
              controller.error(new Error("图片超出大小限制"));
              return;
            }
            controller.enqueue(chunk);
          },
        }),
      );
      return new Response(body, { headers });
    });
  } catch {
    return new Response(null, { status: 502 });
  }
};
