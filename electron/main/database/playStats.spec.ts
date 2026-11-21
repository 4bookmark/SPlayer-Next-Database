// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
const state = vi.hoisted(() => ({ db: undefined as unknown as DatabaseSync }));
vi.mock("./index", () => ({ getDb: () => state.db, isDbOpen: () => true }));
vi.mock("@main/utils/logger", () => ({ libraryLog: { error: vi.fn() } }));
import {
  insertPlayEvent,
  getTopTracks,
  getTopAlbums,
  getTopArtists,
  getRecentTracks,
  getStatsSummary,
} from "./playStats";
beforeEach(() => {
  state.db = new DatabaseSync(":memory:");
  state.db.exec(
    "CREATE TABLE play_history(track_id TEXT,source TEXT,started_at INTEGER,listened_ms INTEGER,track_json TEXT); CREATE TABLE favorite_history(track_id TEXT,source TEXT,action TEXT,at INTEGER,track_json TEXT)",
  );
});
afterEach(() => state.db.close());
/** 为来源隔离测试生成相同资源 ID 的曲目 */
const song = (serverId: string, serverRevision = 0): Track => ({
  id: `${serverId}:song`,
  source: "streaming",
  serverId,
  serverRevision,
  originalId: "song",
  title: "Song",
  artists: [{ id: "artist", name: "Artist" }],
  album: { id: "album", name: "Album" },
  duration: 10000,
});
it("流媒体计入歌曲、专辑、歌手排行和最近播放，不合并不同服务器或账号代次", () => {
  const one = song("one");
  for (const [index, track] of [
    one,
    one,
    song("two"),
    song("one", 1),
    { ...song("local"), source: "local" as const },
  ].entries())
    insertPlayEvent({ track, startedAt: Date.now() + index, listenedMs: 5000 });
  for (const rows of [getTopTracks(10), getTopAlbums(10), getTopArtists(10)]) {
    expect(rows).toHaveLength(4);
    expect(rows[0].track.serverId).toBe("one");
    expect(rows[0].track.serverRevision).toBe(0);
    expect(rows[0].playCount).toBe(2);
    expect(rows.filter((row) => row.track.source === "streaming")).toHaveLength(3);
  }
  expect(getRecentTracks(10)).toHaveLength(4);
  expect(getStatsSummary().totalPlayCount).toBe(5);
  expect(getStatsSummary().totalListenedMs).toBe(25000);
});
