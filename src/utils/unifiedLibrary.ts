import type { Track } from "@shared/types/player";
import type { StreamingCatalog } from "@shared/types/streaming";
import type { CoverItem } from "@/types/artist";

/**
 * 组装本地与媒体源封面卡片，同名资源按来源和原始身份隔离
 * @param mode - 艺术家或专辑
 * @param localTracks - 本地曲目
 * @param catalog - 已应用整理规则的媒体源目录
 * @param names - 来源显示名称
 * @param avatars - 本地歌手头像
 * @returns 可跳转到所属媒体源详情的卡片
 */
export const unifiedCoverItems = (
  mode: "artist" | "album",
  localTracks: Track[],
  catalog: StreamingCatalog,
  names: Record<string, string>,
  avatars: Record<string, string>,
): CoverItem[] => {
  const local = new Map<string, CoverItem>();
  for (const track of localTracks) {
    const resources = mode === "artist" ? track.artists : track.album ? [track.album] : [];
    for (const resource of resources) {
      const name = resource.name.trim();
      if (!name) continue;
      const key = name;
      const existing = local.get(key);
      if (existing) {
        existing.trackCount++;
        continue;
      }
      local.set(key, {
        id: `local:${encodeURIComponent(name)}`,
        title: name,
        source: "local",
        cover:
          mode === "artist"
            ? (avatars[name.toLowerCase()] ?? track.cover)
            : (track.album?.cover ?? track.cover),
        subtitle:
          mode === "album"
            ? `${track.artists.map((a) => a.name).join(" / ")} · ${names.local}`
            : names.local,
        trackCount: 1,
      });
    }
  }
  const counts = new Map<string, number>();
  for (const track of catalog.songs) {
    const resources = mode === "artist" ? track.artists : track.album ? [track.album] : [];
    for (const resource of resources) {
      const key = `${track.serverId}:${resource.id ?? resource.name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const remote = (mode === "artist" ? catalog.artists : catalog.albums).map((resource) => ({
    id: `streaming:${resource.serverId}:${resource.id}`,
    originalId: resource.id,
    title: resource.name,
    source: "streaming" as const,
    serverId: resource.serverId,
    cover:
      "avatar" in resource ? resource.avatar : "cover" in resource ? resource.cover : undefined,
    subtitle: names[resource.serverId!] ?? "",
    trackCount: counts.get(`${resource.serverId}:${resource.id ?? resource.name}`) ?? 0,
    ...("year" in resource ? { year: resource.year } : {}),
    ...("folderPaths" in resource ? { folderPaths: resource.folderPaths } : {}),
  }));
  return [...local.values(), ...remote];
};
