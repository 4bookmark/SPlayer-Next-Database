import type { Track, TrackSource } from "@shared/types/player";

/** 封面摘要卡片 */
export interface CoverItem {
  source?: TrackSource;
  serverId?: string;
  /** 媒体源原始身份，卡片 ID 仅用于列表去重 */
  originalId?: string;
  /** ID */
  id: string;
  /** 标题 */
  title: string;
  /** 封面 */
  cover?: string;
  /** 副标题/描述 */
  subtitle?: string;
  /** 歌曲数量 */
  trackCount: number;
  /** 原始发行年份，仅在服务端提供时展示 */
  year?: number;
  /** 服务端目录，仅用于发行分类 */
  folderPaths?: string[];
}

/** 歌手详情 */
export interface ArtistProfile {
  /** 歌手 ID（URL 编码的名称） */
  id: string;
  /** 歌手名 */
  name: string;
  /** 头像 */
  avatar?: string;
  /** 数据来源 */
  source: TrackSource;
  /** 歌曲列表 */
  tracks: Track[];
  /** 专辑列表 */
  albums: CoverItem[];
  /** 歌曲数量 */
  trackCount: number;
  /** 专辑数量 */
  albumCount: number;
}
