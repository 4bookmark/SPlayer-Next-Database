import type { Album, Artist, Playlist, Track } from "./player";

/** 支持的流媒体服务器类型 */
export type StreamingServerType =
  "subsonic" | "navidrome" | "opensubsonic" | "airsonic" | "gonic" | "lms" | "jellyfin" | "emby";

/** 服务器配置视图 */
export interface StreamingServerConfig {
  /** 配置代次，防止修改身份后旧请求写回 */
  revision?: number;
  /** 账号或地址身份代次，仅改显示名称时保持不变 */
  mediaRevision?: number;
  /** 唯一标识符 */
  id: string;
  /** 服务器显示名称 */
  name: string;
  /** 服务器类型 */
  type: StreamingServerType;
  /** 服务器地址 */
  url: string;
  /** 账号用户名 */
  username: string;
  /** 主进程是否已经保存密码 */
  hasPassword: boolean;
  /** 最后一次连接成功的时间戳（ms） */
  lastConnected?: number;
}

/** 主进程运行时完整服务器配置 */
export interface StreamingRuntimeConfig extends StreamingServerConfig {
  /** 当前任务的取消信号，仅在主进程使用 */
  signal?: AbortSignal;
  /** 明文密码 */
  password: string;
  /** 会话 Token */
  accessToken?: string;
  /** 用户 ID */
  userId?: string;
}

/** 服务器表单提交输入 */
export interface StreamingServerInput {
  /** 服务器显示名称 */
  name: string;
  /** 服务器类型 */
  type: StreamingServerType;
  /** 服务器地址 */
  url: string;
  /** 账号用户名 */
  username: string;
  /** 账号密码 */
  password: string;
}

/** 错误归类 */
export type StreamingErrorCode = "auth" | "network" | "protocol" | "unknown";

/** 连通性测试结果 */
export interface StreamingPingResult {
  /** 是否连通成功 */
  ok: boolean;
  /** 服务器版本号 */
  version?: string;
  /** 失败描述信息 */
  error?: string;
  /** 失败错误码 */
  code?: StreamingErrorCode;
}

/** 连接操作结果 */
export type StreamingConnectResult =
  | { ok: true; server: StreamingServerConfig }
  | { ok: false; error: string; code: StreamingErrorCode };

/** 列表请求通用参数 */
export interface StreamingListParams {
  /** 分页偏移量 */
  offset?: number;
  /** 单页限制条数 */
  limit?: number;
}

/** 搜索结果聚合 */
export interface StreamingSearchResult {
  /** 匹配的歌曲列表 */
  songs: Track[];
  /** 匹配的专辑列表 */
  albums: Album[];
  /** 匹配的歌手列表 */
  artists: Artist[];
}

/** 流媒体服务器媒体快照 */
export interface StreamingLibrarySnapshot {
  organization?: StreamingOrganization;
  /** 全量歌曲列表 */
  songs: Track[];
  /** 全量专辑列表 */
  albums: Album[];
  /** 全量歌手列表 */
  artists: Artist[];
  /** 全量歌单列表 */
  playlists: Playlist[];
}

/** 所有已配置媒体源的统一目录，合集保留所属服务器 */
export interface StreamingCatalog {
  /** 各服务器的本地分类、合并和主封面规则 */
  organizations?: Record<string, StreamingOrganization>;
  songs: Track[];
  albums: Album[];
  artists: Artist[];
}

/** 各媒体服务器的喜欢与本地合集收藏 */
export type StreamingSavedFavorites = StreamingCatalog;

/** 最近一次专辑目录扫描的图片可用状态 */
export interface AlbumArtworkStatus {
  found: number;
  unavailable: string[];
  error?: "directory-unavailable" | "extension-unavailable" | "request-failed" | "auth-failed";
}

/** 专辑目录中的附加图片，路径仅在主进程保存 */
export interface AlbumArtwork {
  /** 当前已保存的封面选择 */
  selected?: boolean;
  id: string;
  name: string;
  thumbnail: string;
  original: string;
}

/** 渲染进程通过 contextBridge 调用的流媒体 API */
export interface StreamingApi {
  /** 读取全部已同步媒体源目录，沿用合并和主封面整理规则 */
  getCatalog(): Promise<StreamingCatalog>;
  /** 读取所有已配置服务器的收藏，不发起网络请求 */
  getSavedFavorites(): Promise<StreamingSavedFavorites>;
  /**
   * 读取最近一次图片扫描状态，区分不可读图片与空目录
   * @param serverId - 服务器 ID
   * @param albumId - 原始专辑 ID
   * @returns 文件数量与不可用图片名
   */
  getAlbumArtworkStatus(serverId: string, albumId: string): Promise<AlbumArtworkStatus>;
  /**
   * 保存专辑封面选择，空 ID 恢复服务端默认封面
   * @param serverId - 服务器 ID
   * @param albumId - 原始专辑 ID
   * @param artworkId - 已枚举的稳定图片 ID
   * @returns 含已选状态的图片列表
   */
  setAlbumArtwork(serverId: string, albumId: string, artworkId: string): Promise<AlbumArtwork[]>;
  /**
   * 读取专辑目录的图片
   * @param serverId - 服务器 ID
   * @param albumId - 专辑 ID
   * @returns 有界图片列表
   */
  getAlbumArtworks(serverId: string, albumId: string): Promise<AlbumArtwork[]>;
  organize(serverId: string, action: OrganizationAction): Promise<StreamingLibrarySnapshot>;
  /**
   * 读取服务端收藏状态
   * @param serverId - 服务器 ID
   * @param trackId - 服务端歌曲 ID
   * @returns 收藏状态
   */
  getFavorite: (serverId: string, trackId: string) => Promise<boolean>;
  /**
   * 更新服务端收藏状态
   * @param serverId - 服务器 ID
   * @param trackId - 服务端歌曲 ID
   * @param favorite - 目标状态
   * @returns 服务端确认的状态
   */
  setFavorite: (serverId: string, trackId: string, favorite: boolean) => Promise<boolean>;
  /**
   * 订阅单曲收藏变化
   * @param callback - 变更回调
   * @returns 取消订阅函数
   */
  onFavoriteChanged: (callback: (change: StreamingFavoriteChange) => void) => () => void;
  /**
   * 订阅后台同步状态
   * @param callback - 状态回调
   * @returns 取消订阅函数
   */
  onSyncState: (callback: (state: StreamingSyncState) => void) => () => void;
  /**
   * 读取服务器配置和当前激活项
   * @returns 运行时服务器配置与激活服务器 ID
   */
  loadServers: () => Promise<{
    servers: StreamingServerConfig[];
    activeServerId: string | null;
  }>;
  /**
   * 新增服务器
   * @param input - 服务器表单
   * @returns 新服务器视图
   */
  addServer: (input: StreamingServerInput) => Promise<StreamingServerConfig>;
  /**
   * 更新服务器
   * @param serverId - 服务器 ID
   * @param input - 服务器表单
   * @returns 更新后的服务器视图
   */
  updateServer: (serverId: string, input: StreamingServerInput) => Promise<StreamingServerConfig>;
  /**
   * 删除服务器
   * @param serverId - 服务器 ID
   * @returns 删除完成
   */
  removeServer: (serverId: string) => Promise<void>;
  /**
   * 保存激活服务器
   * @param serverId - 激活服务器 ID
   * @returns 保存完成
   */
  setActiveServer: (serverId: string | null) => Promise<void>;
  /**
   * 测试服务器连接
   * @param input - 服务器表单
   * @param serverId - 编辑中的服务器 ID
   * @returns 连通性结果
   */
  testConnection: (input: StreamingServerInput, serverId?: string) => Promise<StreamingPingResult>;
  /**
   * 连接服务器
   * @param serverId - 服务器 ID
   * @returns 连接结果
   */
  connect: (serverId: string) => Promise<StreamingConnectResult>;
  /**
   * 断开服务器会话
   * @param serverId - 服务器 ID
   * @returns 断开完成
   */
  disconnect: (serverId: string) => Promise<void>;
  /**
   * 读取主进程 SQLite 媒体库快照
   * @param serverId - 服务器 ID
   * @returns 服务器的完整媒体库快照
   */
  getSnapshot: (serverId: string) => Promise<StreamingLibrarySnapshot>;
  /**
   * 启动后台同步
   * @param serverId - 服务器 ID
   * @param force - 是否忽略本次应用运行内的成功同步记录
   * @returns 是否启动了新任务
   */
  sync: (serverId: string, force?: boolean) => Promise<boolean>;
  /**
   * 订阅媒体库更新
   * @param callback - 收到更新的服务器 ID
   * @returns 取消订阅函数
   */
  onLibraryUpdated: (callback: (serverId: string) => void) => () => void;
  /**
   * 搜索主进程 SQLite 中的流媒体
   * @param serverId - 服务器 ID
   * @param query - 搜索关键词
   * @returns 歌曲、专辑和歌手搜索结果
   */
  search: (serverId: string, query: string) => Promise<StreamingSearchResult>;
  /**
   * 读取专辑歌曲
   * @param serverId - 服务器 ID
   * @param albumId - 服务端专辑 ID
   * @returns 专辑歌曲
   */
  getAlbumSongs: (serverId: string, albumId: string) => Promise<Track[]>;
  /**
   * 读取歌单歌曲
   * @param serverId - 服务器 ID
   * @param playlistId - 服务端歌单 ID
   * @returns 歌单歌曲
   */
  getPlaylistSongs: (serverId: string, playlistId: string) => Promise<Track[]>;
  /**
   * 读取歌手专辑
   * @param serverId - 服务器 ID
   * @param artistId - 服务端歌手 ID
   * @returns 歌手专辑
   */
  getArtistAlbums: (serverId: string, artistId: string) => Promise<Album[]>;
  /**
   * 读取歌手歌曲
   * @param serverId - 服务器 ID
   * @param artistId - 服务端歌手 ID
   * @returns 歌手歌曲
   */
  getArtistSongs: (serverId: string, artistId: string) => Promise<Track[]>;
  /**
   * 读取流媒体歌词
   * @param serverId - 服务器 ID
   * @param trackId - 服务端歌曲 ID
   * @param hint - 旧 Subsonic 歌词端点使用的歌曲信息
   * @returns 原始歌词文本
   */
  getLyrics: (
    serverId: string,
    trackId: string,
    hint?: { artist?: string; title?: string },
  ) => Promise<string | null>;
}

/** 单曲收藏变更，不重传整个媒体库 */
export interface StreamingFavoriteChange {
  serverId: string;
  trackId: string;
  favorite: boolean;
}

/** 后台同步任务状态 */
export interface StreamingSyncState {
  serverId: string;
  state: "running" | "completed" | "cancelled" | "failed";
  error?: string;
}

/** 当前服务器的本地整理规则，不修改远端文件 */
/** 主进程验证后保存的专辑封面，图片路径不接受渲染进程输入 */
export interface AlbumArtworkChoice {
  /** 新版通过 gonic HTTP 获取，未标记的旧版挂载选择不再应用 */
  source?: "gonic-http";
  file: string;
  thumbnail: string;
  id: string;
  root: string;
}

export interface StreamingOrganization {
  /** 本地收藏的原始专辑与歌手 ID，随服务器身份隔离 */
  favoriteAlbumIds?: string[];
  favoriteArtistIds?: string[];
  /** 服务器隔离的持久化封面选择 */
  albumArtworkChoices?: Record<string, AlbumArtworkChoice>;
  /** 此服务器的只读挂载曲库目录 */
  artworkRoot?: string;
  artistGroups: { targetId: string; memberIds: string[] }[];
  /** 歌手自定义分类，与专辑分类分别维护 */
  artistCategoryDefinitions?: { id: string; name: string }[];
  /** 原始歌手 ID 对应的分类，合并时保留各成员原值 */
  artistCategories?: Record<string, string>;
  categories: { id: string; name: string }[];
  albumCategories: Record<string, string>;
}

export type OrganizationAction =
  | { type: "favorite-album"; id: string; favorite: boolean }
  | { type: "favorite-artist"; id: string; favorite: boolean }
  | { type: "merge"; selectedIds: string[]; targetId: string }
  | { type: "unmerge"; targetId: string }
  | { type: "artist-category-create"; name: string }
  | { type: "artist-category-rename"; id: string; name: string }
  | { type: "artist-category-delete"; id: string }
  | { type: "artist-classify"; artistIds: string[]; categoryId: string }
  | { type: "category-create"; name: string }
  | { type: "category-rename"; id: string; name: string }
  | { type: "category-delete"; id: string }
  | { type: "classify"; albumIds: string[]; categoryId: string };
