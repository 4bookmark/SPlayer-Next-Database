import type { Album, Track } from "../types/player";

const categoryMarkers = [
  [
    "soundtrack",
    /(?:^|[^a-z0-9])(?:soundtracks?|o\.?s\.?t\.?)(?=$|[^a-z0-9])|原声|原聲|电影|電影|电视原声|電視原聲/i,
  ],
  ["live", /(?:^|[^a-z0-9])live(?=$|[^a-z0-9])|现场|現場|演唱会|演唱會|音乐会|音樂會/i],
  [
    "compilation",
    /(?:^|[^a-z0-9])(?:compilations?|best[\s_-]+of|greatest[\s_-]+hits)(?=$|[^a-z0-9])|精选|精選|合集/i,
  ],
  ["single-ep", /(?:^|[^a-z0-9])(?:singles?|ep)(?=$|[^a-z0-9])|单曲|單曲/i],
] as const;

/**
 * 从目录标记、专辑标题和可靠曲目数依次推断专辑分类
 * @param album - 专辑标题、目录元数据及音频曲目数
 * @param maxSingleTracks - 单曲或 EP 的最大曲目数，零表示关闭数量推断
 * @returns 内置分类 ID；信息不足时不推断
 */
export const inferAlbumCategory = (
  album: Pick<Album, "name" | "folderPaths" | "trackCount">,
  maxSingleTracks = 6,
): string | undefined => {
  for (const text of [...(album.folderPaths ?? []), album.name]) {
    const marker = categoryMarkers.find(([, pattern]) => pattern.test(text));
    if (marker) return marker[0];
  }
  if (
    maxSingleTracks <= 0 ||
    !Number.isInteger(maxSingleTracks) ||
    !Number.isInteger(album.trackCount) ||
    album.trackCount! <= 0
  )
    return undefined;
  return album.trackCount! <= maxSingleTracks ? "single-ep" : "album";
};

/**
 * 按原始专辑 ID 汇集服务端歌曲所在目录，保留父级分类和碟片目录
 * @param songs - 同一服务器的歌曲元数据，仅读取 libraryPath
 * @returns 使用正斜杠并去重的专辑目录
 */
export const albumFolderPaths = (songs: Track[]): Map<string, string[]> => {
  const directories = new Map<string, Set<string>>();
  for (const song of songs) {
    if (!song.album?.id || !song.libraryPath) continue;
    const path = song.libraryPath
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/{2,}/g, "/");
    const separator = path.lastIndexOf("/");
    if (separator < 0) continue;
    const directory = path.slice(0, separator) || "/";
    const albumDirectories = directories.get(song.album.id) ?? new Set<string>();
    albumDirectories.add(directory);
    directories.set(song.album.id, albumDirectories);
  }
  return new Map([...directories].map(([id, paths]) => [id, [...paths]]));
};
