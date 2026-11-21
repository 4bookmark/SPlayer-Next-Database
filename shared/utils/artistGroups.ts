import type { Artist, Track, Album } from "../types/player";
import type { StreamingLibrarySnapshot, StreamingOrganization } from "../types/streaming";
import { albumFolderPaths } from "./albumCategories";

/** 创建无本地覆盖的整理规则 */
export const emptyOrganization = (): StreamingOrganization => ({
  artistGroups: [],
  categories: [],
  albumCategories: {},
});

/** 解析歌手的本地分组目标，不修改远端身份 */
export const resolveArtistId = (organization: StreamingOrganization, id: string): string =>
  organization.artistGroups.find((group) => group.memberIds.includes(id))?.targetId ?? id;

/**
 * 读取歌手展示分类，合并成员使用目标分类而不覆盖原始记录
 * @param organization - 当前服务器的本地整理规则
 * @param id - 原始歌手 ID
 * @returns 展示分类 ID，未分类时为空字符串
 */
export const artistCategoryId = (organization: StreamingOrganization, id: string): string => {
  const targetId = resolveArtistId(organization, id);
  return organization.artistCategories && Object.hasOwn(organization.artistCategories, targetId)
    ? organization.artistCategories[targetId]!
    : "";
};

/** 获取合并歌手的全部原始成员 */
export const artistMemberIds = (organization: StreamingOrganization, id: string): string[] =>
  organization.artistGroups.find((group) => group.memberIds.includes(id))?.memberIds ?? [id];

/** 校验目标并将相交的已有分组扁平化合并 */
export const mergeArtistGroups = (
  organization: StreamingOrganization,
  selectedIds: string[],
  targetId: string,
): StreamingOrganization => {
  const ids = new Set(selectedIds);
  if (ids.size < 2 || !ids.has(targetId))
    throw new Error("请选择至少两位歌手，并从选中项指定保留的歌手");
  for (const group of organization.artistGroups)
    if (group.memberIds.some((id) => ids.has(id))) group.memberIds.forEach((id) => ids.add(id));
  return {
    ...organization,
    artistGroups: [
      ...organization.artistGroups.filter((group) => !group.memberIds.some((id) => ids.has(id))),
      { targetId, memberIds: [...ids].sort() },
    ],
  };
};

/** 为当前服务器建立歌手展示映射，名称回退只匹配完整名称 */
export const createArtistMapper = (
  artists: Artist[],
  organization: StreamingOrganization,
): ((artist: Artist) => Artist) => {
  const byId = new Map(artists.filter((a) => a.id).map((a) => [a.id!, a]));
  const byName = new Map(artists.map((a) => [a.name, a]));
  return (artist) => {
    const original = artist.id ? byId.get(artist.id) : byName.get(artist.name);
    if (!original?.id) return artist;
    const targetId = resolveArtistId(organization, original.id);
    const target = byId.get(targetId);
    return target && targetId !== original.id ? { ...artist, ...target } : artist;
  };
};

/**
 * 读取通过 HTTP 确认的主封面，不再应用旧版挂载图片
 * @param organization - 本地整理规则
 * @param albumId - 原始专辑 ID
 * @returns 已保存的主进程代理缩略图地址
 */
export const getAlbumArtworkCover = (
  organization: StreamingOrganization,
  albumId: string | undefined,
): string | undefined => {
  const choice = albumId ? organization.albumArtworkChoices?.[albumId] : undefined;
  return choice?.source === "gonic-http" ? choice.thumbnail : undefined;
};

/**
 * 为快照应用展示规则并补充专辑目录，不修改原始快照或媒体身份
 * @param snapshot - 同一服务器的原始媒体快照
 * @param organization - 本地歌手分组和专辑整理规则
 * @returns 应用展示映射和目录元数据的新快照
 */
export const decorateLibrary = (
  snapshot: StreamingLibrarySnapshot,
  organization: StreamingOrganization,
): StreamingLibrarySnapshot => {
  const mapArtist = createArtistMapper(snapshot.artists, organization);
  const trackCovers = new Map<string, string>();
  for (const track of snapshot.songs)
    if (track.album?.id && track.cover && !trackCovers.has(track.album.id))
      trackCovers.set(track.album.id, track.cover);
  const folders = albumFolderPaths(snapshot.songs);
  /**
   * 保留专辑自身目录优先级，并附加所属歌曲目录和歌手展示名称
   * @param album - 原始专辑
   * @returns 保留原始身份的专辑展示元数据
   */
  const mapAlbum = (album: Album): Album => {
    const folderPaths = [
      ...new Set(
        [...(album.folderPaths ?? []), ...(album.id ? (folders.get(album.id) ?? []) : [])]
          .map((path) =>
            path
              .trim()
              .replace(/\\/g, "/")
              .replace(/\/{2,}/g, "/")
              .replace(/\/$/, ""),
          )
          .filter(Boolean),
      ),
    ];
    return {
      ...album,
      ...(album.id && trackCovers.has(album.id) ? { cover: trackCovers.get(album.id) } : {}),
      ...(getAlbumArtworkCover(organization, album.id)
        ? { cover: getAlbumArtworkCover(organization, album.id) }
        : {}),
      ...(album.artist ? { artist: mapArtist({ name: album.artist }).name } : {}),
      ...(folderPaths.length ? { folderPaths } : {}),
    };
  };
  /**
   * 映射歌曲的歌手与专辑展示信息并保留播放身份
   * @param track - 原始歌曲
   * @returns 应用本地整理规则的歌曲
   */
  const mapTrack = (track: Track): Track => ({
    ...track,
    artists: [...new Map(track.artists.map(mapArtist).map((a) => [a.id ?? a.name, a])).values()],
    album: track.album ? mapAlbum(track.album) : undefined,
  });
  return {
    ...snapshot,
    organization,
    artists: snapshot.artists.filter((a) => !a.id || resolveArtistId(organization, a.id) === a.id),
    songs: snapshot.songs.map(mapTrack),
    albums: snapshot.albums.map(mapAlbum),
  };
};
