import fs from "node:fs";
import path from "node:path";
import { writeFileSync } from "atomically";
import type {
  AlbumArtworkChoice,
  OrganizationAction,
  StreamingOrganization,
} from "@shared/types/streaming";
import {
  emptyOrganization,
  mergeArtistGroups,
  artistMemberIds,
  decorateLibrary,
} from "@shared/utils/artistGroups";
import { configDir } from "@main/utils/paths";
import { getArtists } from "@main/database/streaming/artists";
import { getAlbums } from "@main/database/streaming/albums";
import { getStreamingConfig } from "./config";
import type { Album, Track } from "@shared/types/player";

const file = path.join(configDir, "streaming-organization.json");
const BUILTIN = new Set([
  "album",
  "compilation",
  "single-ep",
  "live",
  "soundtrack",
  "uncategorized",
]);

/** 每次读取原子文件，避免原始快照刷新覆盖用户整理 */
const read = (): Record<string, StreamingOrganization> => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
};

/** 读取服务器隔离的整理规则 */
export const getOrganization = (serverId: string): StreamingOrganization =>
  read()[serverId] ?? emptyOrganization();

/** 身份变化或移除服务器后清除整理规则 */
export const clearOrganization = (serverId: string): void => {
  const data = read();
  if (!data[serverId]) return;
  delete data[serverId];
  writeFileSync(file, JSON.stringify(data));
};

/**
 * 归一化分类名并在指定分类集合中校验唯一性
 * @param name - 用户输入的分类名
 * @param definitions - 同一用途下的已有分类
 * @param excludedId - 重命名时排除的分类 ID
 * @returns 去除首尾空白的有效分类名
 */
const categoryName = (
  name: string,
  definitions: { id: string; name: string }[],
  excludedId?: string,
): string => {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60)
    throw new Error("分类名称须为 1–60 个字符");
  const value = name.trim();
  if (
    definitions.some(
      (c) => c.id !== excludedId && c.name.toLocaleLowerCase() === value.toLocaleLowerCase(),
    )
  )
    throw new Error("分类名称已存在");
  return value;
};

/**
 * 校验服务器身份及整理输入，并原子保存歌手或专辑的独立分类
 * @param serverId - 当前媒体服务器 ID
 * @param action - 本地整理操作
 */
export const organizeLibrary = (serverId: string, action: OrganizationAction): void => {
  if (!getStreamingConfig().servers.some((s) => s.id === serverId))
    throw new Error("媒体服务器不存在");
  const all = read();
  let data = all[serverId] ?? emptyOrganization();
  if (action.type === "favorite-album" || action.type === "favorite-artist") {
    const album = action.type === "favorite-album";
    const records = album ? getAlbums(serverId) : getArtists(serverId);
    if (
      typeof action.id !== "string" ||
      typeof action.favorite !== "boolean" ||
      !records.some((item) => item.id === action.id)
    )
      throw new Error("收藏对象不属于当前曲库");
    const field = album ? "favoriteAlbumIds" : "favoriteArtistIds";
    const ids = new Set(data[field] ?? []);
    if (action.favorite) ids.add(action.id);
    else for (const id of album ? [action.id] : artistMemberIds(data, action.id)) ids.delete(id);
    data = { ...data, [field]: [...ids] };
  } else if (action.type === "merge") {
    const ids = new Set(getArtists(serverId).map((a) => a.id));
    if (
      !Array.isArray(action.selectedIds) ||
      action.selectedIds.some((id) => typeof id !== "string" || !ids.has(id))
    )
      throw new Error("所选歌手不属于当前曲库");
    data = mergeArtistGroups(data, action.selectedIds, action.targetId);
  } else if (action.type === "unmerge") {
    data.artistGroups = data.artistGroups.filter((g) => g.targetId !== action.targetId);
  } else if (action.type === "artist-category-create") {
    const definitions = data.artistCategoryDefinitions ?? [];
    data.artistCategoryDefinitions = [
      ...definitions,
      { id: crypto.randomUUID(), name: categoryName(action.name, definitions) },
    ];
  } else if (action.type === "artist-category-rename") {
    const definitions = data.artistCategoryDefinitions ?? [];
    const category = definitions.find((c) => c.id === action.id);
    if (!category) throw new Error("歌手分类不存在");
    category.name = categoryName(action.name, definitions, action.id);
  } else if (action.type === "artist-category-delete") {
    const definitions = data.artistCategoryDefinitions ?? [];
    if (!definitions.some((c) => c.id === action.id)) throw new Error("歌手分类不存在");
    data.artistCategoryDefinitions = definitions.filter((c) => c.id !== action.id);
    data.artistCategories = Object.fromEntries(
      Object.entries(data.artistCategories ?? {}).filter(
        ([, categoryId]) => categoryId !== action.id,
      ),
    );
  } else if (action.type === "artist-classify") {
    if (
      typeof action.categoryId !== "string" ||
      (action.categoryId &&
        !data.artistCategoryDefinitions?.some((c) => c.id === action.categoryId))
    )
      throw new Error("歌手分类不存在");
    const ids = new Set(getArtists(serverId).map((artist) => artist.id));
    if (
      !Array.isArray(action.artistIds) ||
      action.artistIds.some((id) => typeof id !== "string" || !ids.has(id))
    )
      throw new Error("所选歌手不属于当前曲库");
    const assignments = new Map(Object.entries(data.artistCategories ?? {}));
    for (const id of action.artistIds) {
      if (action.categoryId) assignments.set(id, action.categoryId);
      else assignments.delete(id);
    }
    data.artistCategories = Object.fromEntries(assignments);
  } else if (action.type === "category-create") {
    data.categories.push({
      id: crypto.randomUUID(),
      name: categoryName(action.name, data.categories),
    });
  } else if (action.type === "category-rename") {
    const category = data.categories.find((c) => c.id === action.id);
    if (!category) throw new Error("分类不存在");
    category.name = categoryName(action.name, data.categories, action.id);
  } else if (action.type === "category-delete") {
    if (BUILTIN.has(action.id)) throw new Error("内置分类不能删除");
    data.categories = data.categories.filter((c) => c.id !== action.id);
    for (const id of Object.keys(data.albumCategories))
      if (data.albumCategories[id] === action.id) data.albumCategories[id] = "uncategorized";
  } else if (action.type === "classify") {
    if (
      action.categoryId &&
      !BUILTIN.has(action.categoryId) &&
      !data.categories.some((c) => c.id === action.categoryId)
    )
      throw new Error("分类不存在");
    const ids = new Set(getAlbums(serverId).map((a) => a.id));
    if (!Array.isArray(action.albumIds) || action.albumIds.some((id) => !ids.has(id)))
      throw new Error("所选专辑不属于当前曲库");
    for (const id of action.albumIds) {
      if (action.categoryId) data.albumCategories[id] = action.categoryId;
      else delete data.albumCategories[id];
    }
  } else throw new Error("未知整理操作");
  all[serverId] = data;
  fs.mkdirSync(configDir, { recursive: true });
  writeFileSync(file, JSON.stringify(all));
};

/** 获取歌手原始分组成员供详情聚合使用 */
export const getArtistMembers = (serverId: string, id: string): string[] =>
  artistMemberIds(getOrganization(serverId), id);

/** 为详情中的远端曲目和专辑应用当前服务器的展示覆盖 */
export const decorateDetails = (serverId: string, songs: Track[], albums: Album[] = []) =>
  decorateLibrary(
    { artists: getArtists(serverId), songs, albums, playlists: [] },
    getOrganization(serverId),
  );

/**
 * 保存服务器隔离的图片读取目录，身份清除时一并删除
 * @param serverId - 服务器 ID
 * @param root - 用户选择的真实目录
 */
export const setArtworkRoot = (serverId: string, root: string): void => {
  if (!getStreamingConfig().servers.some((server) => server.id === serverId))
    throw new Error("媒体服务器不存在");
  const all = read();
  const previous = all[serverId] ?? emptyOrganization();
  all[serverId] = {
    ...previous,
    artworkRoot: root,
    ...(previous.artworkRoot !== root ? { albumArtworkChoices: {} } : {}),
  };
  fs.mkdirSync(configDir, { recursive: true });
  writeFileSync(file, JSON.stringify(all));
};

/**
 * 原子保存已验证的专辑图片选择，清空时恢复远端封面
 * @param serverId - 服务器 ID
 * @param albumId - 原始专辑 ID
 * @param choice - 主进程验证的选择，空值表示清除
 */
export const setAlbumArtworkChoice = (
  serverId: string,
  albumId: string,
  choice?: AlbumArtworkChoice,
): void => {
  if (!getStreamingConfig().servers.some((server) => server.id === serverId))
    throw new Error("媒体服务器不存在");
  const all = read();
  const data = all[serverId] ?? emptyOrganization();
  const choices = new Map(Object.entries(data.albumArtworkChoices ?? {}));
  if (choice) choices.set(albumId, choice);
  else choices.delete(albumId);
  all[serverId] = { ...data, albumArtworkChoices: Object.fromEntries(choices) };
  fs.mkdirSync(configDir, { recursive: true });
  writeFileSync(file, JSON.stringify(all));
};
