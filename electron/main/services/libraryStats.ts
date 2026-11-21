import { getLibraryStats } from "@main/database";
import { getStreamingCatalog } from "./streaming/library";
import type { LibraryStats } from "@shared/types/stats";

/** 汇总本地和全部已同步媒体源，采用与统一目录相同的整理后资源数量 */
export const getUnifiedLibraryStats = (): LibraryStats => {
  const local = getLibraryStats();
  const catalog = getStreamingCatalog();
  const codecs = new Map(local.codecs.map(({ codec, count }) => [codec.toLowerCase(), count]));
  let duration = local.totalDurationMs;
  let fileSize = local.totalFileSize;
  let unknownFileSizeCount = local.unknownFileSizeCount ?? 0;
  for (const track of catalog.songs) {
    duration += track.duration;
    if (track.fileSize !== undefined && track.fileSize > 0) fileSize += track.fileSize;
    else unknownFileSizeCount++;
    const codec = track.quality?.codec?.toLowerCase() ?? "";
    codecs.set(codec, (codecs.get(codec) ?? 0) + 1);
  }
  return {
    trackCount: local.trackCount + catalog.songs.length,
    albumCount: local.albumCount + catalog.albums.length,
    artistCount: local.artistCount + catalog.artists.length,
    totalDurationMs: duration,
    totalFileSize: fileSize,
    unknownFileSizeCount,
    codecs: [...codecs]
      .map(([codec, count]) => ({ codec, count }))
      .sort((a, b) => b.count - a.count || a.codec.localeCompare(b.codec)),
  };
};
