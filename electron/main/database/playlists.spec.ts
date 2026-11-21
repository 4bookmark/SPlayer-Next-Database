// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
const state = vi.hoisted(() => ({
  db: undefined as unknown as DatabaseSync & { transaction: <T>(fn: () => T) => () => T },
}));
vi.mock("@main/database", () => ({ getDb: () => state.db }));
vi.mock("@main/database/queries", () => ({
  getTracksByIds: (ids: string[]) =>
    ids.flatMap((id) => {
      const row = state.db.prepare("SELECT data FROM tracks WHERE id=?").get(id) as
        { data: string } | undefined;
      return row ? [JSON.parse(row.data)] : [];
    }),
}));
import {
  addPlaylistTracks,
  createPlaylist,
  getPlaylist,
  getPlaylists,
  removePlaylistTracks,
  removeServerPlaylistTracks,
} from "./playlists";
const local: Track = { id: "local", source: "local", title: "Local", artists: [], duration: 1 };
const remote: Track = {
  id: "a:song:1",
  source: "streaming",
  serverId: "a",
  originalId: "song:1",
  title: "Remote",
  cover: "streaming-cover://cover",
  artists: [],
  duration: 2,
};
beforeEach(() => {
  state.db = new DatabaseSync(":memory:") as typeof state.db;
  state.db.transaction = (fn) => () => {
    state.db.exec("BEGIN");
    try {
      const value = fn();
      state.db.exec("COMMIT");
      return value;
    } catch (e) {
      state.db.exec("ROLLBACK");
      throw e;
    }
  };
  state.db.exec(`CREATE TABLE tracks(id TEXT PRIMARY KEY,data TEXT,cover TEXT);
  CREATE TABLE remote_tracks(server_id TEXT,remote_id TEXT,data TEXT,PRIMARY KEY(server_id,remote_id));
  CREATE TABLE playlists(id TEXT PRIMARY KEY,type TEXT,title TEXT,description TEXT,cover TEXT,created_at INTEGER,updated_at INTEGER);
  CREATE TABLE playlist_tracks(playlist_id TEXT,track_id TEXT,position INTEGER,added_at INTEGER,PRIMARY KEY(playlist_id,track_id));`);
  state.db.prepare("INSERT INTO tracks VALUES(?,?,?)").run(local.id, JSON.stringify(local), null);
  state.db
    .prepare("INSERT INTO remote_tracks VALUES(?,?,?)")
    .run("a", "song:1", JSON.stringify(remote));
  state.db
    .prepare("INSERT INTO remote_tracks VALUES(?,?,?)")
    .run(
      "b",
      "song:1",
      JSON.stringify({ ...remote, id: "b:song:1", serverId: "b", title: "Other server" }),
    );
});
afterEach(() => state.db.close());
describe("媒体源加入本地歌单", () => {
  it("混合歌曲按用户顺序保存、去重并正确显示封面和数量", () => {
    const pl = createPlaylist({ type: "local", title: "Mix" });
    expect(addPlaylistTracks(pl.id, [remote.id, local.id, remote.id, "foreign:missing"])).toBe(2);
    expect(getPlaylist(pl.id)?.tracks.map((t) => t.id)).toEqual([remote.id, local.id]);
    expect(getPlaylists()[0]).toMatchObject({ trackCount: 2, cover: remote.cover });
    expect(addPlaylistTracks(pl.id, [remote.id])).toBe(0);
    expect(addPlaylistTracks(pl.id, ["b:song:1"])).toBe(1);
    expect(getPlaylist(pl.id)?.tracks.map((t) => t.id)).toEqual(["b:song:1", remote.id, local.id]);
    expect(removePlaylistTracks(pl.id, [remote.id])).toBe(1);
    expect(getPlaylist(pl.id)?.tracks.map((t) => t.id)).toEqual(["b:song:1", local.id]);
  });
  it("读取引用使用最新元数据，服务器移除不会影响另一个服务器或本机歌曲", () => {
    const pl = createPlaylist({ type: "local", title: "Mix" });
    addPlaylistTracks(pl.id, [remote.id, local.id, "b:song:1"]);
    state.db
      .prepare("UPDATE remote_tracks SET data=? WHERE server_id='a'")
      .run(JSON.stringify({ ...remote, title: "Changed" }));
    expect(getPlaylist(pl.id)?.tracks[0].title).toBe("Changed");
    removeServerPlaylistTracks("a");
    state.db.prepare("DELETE FROM remote_tracks WHERE server_id='a'").run();
    expect(getPlaylist(pl.id)?.tracks.map((t) => t.id)).toEqual([local.id, "b:song:1"]);
    expect(getPlaylists()[0].trackCount).toBe(2);
    state.db
      .prepare("INSERT INTO remote_tracks VALUES(?,?,?)")
      .run("a", "song:1", JSON.stringify({ ...remote, title: "New account" }));
    expect(getPlaylist(pl.id)?.tracks.some((t) => t.serverId === "a")).toBe(false);
  });
});
