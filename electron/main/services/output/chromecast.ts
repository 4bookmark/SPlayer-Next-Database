import { Client, DefaultMediaReceiver } from "castv2-client";
import type { MediaStatus, Callback } from "castv2-client";
import type {
  OutputTarget,
  OutputStatusListener,
  RemoteOutputBackend,
  OutputPlaybackStatus,
} from "@shared/types/output";
import { mediaContentType } from "./upnp";

/** 连接 CastV2 默认媒体接收器，不自动装载媒体
 * @param target - Chromecast 设备
 * @param onStatus - 播放状态监听
 * @param onError - 连接错误监听
 * @returns 远程播放后端
 */
export async function createChromecastBackend(
  target: OutputTarget,
  onStatus: OutputStatusListener,
  onError: (message: string) => void,
): Promise<RemoteOutputBackend> {
  return connectCastBackend(new Client(), target, onStatus, onError);
}

/** 管理独立 Cast 连接和有界请求，支持协议模拟测试
 * @param client - Cast 协议连接
 * @param target - 目标设备
 * @param onStatus - 播放状态监听
 * @param onError - 连接错误监听
 * @returns 已连接的播放后端
 */
export async function connectCastBackend(
  client: Client,
  target: OutputTarget,
  onStatus: OutputStatusListener,
  onError: (message: string) => void,
): Promise<RemoteOutputBackend> {
  if (!target.address) throw new Error("Missing Chromecast address");
  let closed = false;
  let connected = false;
  let receiver: DefaultMediaReceiver | undefined;
  let timer: ReturnType<typeof setInterval> | undefined = undefined;
  let polling = false;
  let loadedUrl = "";
  let generation = 0;
  let sessionId: number | undefined;
  let intentionalStop = false;
  let finishedSession: number | undefined;
  const pending = new Set<(error: Error) => void>();
  const state: OutputPlaybackStatus = {
    state: "idle",
    positionMs: 0,
    durationMs: 0,
    volume: 1,
    external: true,
  };

  /** 关闭连接并拒绝尚未完成的命令 */
  function dispose(): void {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    for (const reject of pending) reject(new Error("Chromecast connection closed"));
    pending.clear();
    receiver?.removeListener("status", update);
    // castv2-client 在通道关闭时会发送 STOP，断开时禁用该隐式动作
    if (receiver) receiver.media.stop = () => {};
    client.removeListener("status", volumeStatus);
    try {
      client.close();
    } catch {
      /* 底层套接字可能已经关闭 */
    }
  }
  /** 处理连接故障
   * @param error - 协议或网络错误
   */
  function fail(error: Error): void {
    if (closed) return;
    const notify = connected;
    dispose();
    if (notify) onError(error.message);
  }
  client.on("error", fail);
  const connection = client.client;
  connection?.on("close", () => fail(new Error("Chromecast disconnected")));
  client.on("close", () => fail(new Error("Chromecast disconnected")));

  /** 为回调协议增加超时和关闭取消
   * @param invoke - 协议调用
   * @returns 协议响应
   */
  function request<T>(invoke: (callback: Callback<T>) => void): Promise<T> {
    if (closed) return Promise.reject(new Error("Chromecast connection closed"));
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      /** 完成请求并清理计时器
       * @param error - 协议错误
       * @param result - 协议响应
       */
      function finish(error: Error | null, result?: T): void {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        pending.delete(cancel);
        if (error) reject(error);
        else resolve(result as T);
      }
      /** 取消当前请求
       * @param error - 取消原因
       */
      function cancel(error: Error): void {
        finish(error);
      }
      const timeout = setTimeout(() => {
        const error = new Error("Chromecast request timed out");
        finish(error);
        fail(error);
      }, 5000);
      pending.add(cancel);
      try {
        invoke(finish);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  /** 仅同步当前媒体会话，过滤停止与替换导致的结束状态
   * @param status - Cast 媒体状态
   */
  function update(status: MediaStatus | undefined): void {
    if (closed || !status || !loadedUrl) return;
    if (status.media?.contentId && status.media.contentId !== loadedUrl) {
      fail(new Error("Chromecast media was replaced by another sender"));
      return;
    }
    if (
      sessionId !== undefined &&
      status.mediaSessionId !== undefined &&
      sessionId !== status.mediaSessionId
    )
      return;
    state.state =
      status.playerState === "PLAYING"
        ? "playing"
        : status.playerState === "PAUSED"
          ? "paused"
          : status.playerState === "BUFFERING"
            ? "loading"
            : "stopped";
    if (Number.isFinite(status.currentTime))
      state.positionMs = Math.max(0, status.currentTime! * 1000);
    if (Number.isFinite(status.media?.duration))
      state.durationMs = Math.max(0, status.media!.duration! * 1000);
    const finished =
      !intentionalStop &&
      status.playerState === "IDLE" &&
      status.idleReason === "FINISHED" &&
      status.mediaSessionId !== undefined &&
      finishedSession !== status.mediaSessionId;
    if (finished) finishedSession = status.mediaSessionId;
    if (status.idleReason === "ERROR") {
      fail(new Error("Chromecast could not play this media"));
      return;
    }
    onStatus({ ...state, finished });
  }
  /** 同步接收器硬件音量
   * @param status - 接收器状态
   */
  function volumeStatus(status: { volume?: { level?: number } }): void {
    if (closed || !Number.isFinite(status.volume?.level)) return;
    state.volume = Math.min(1, Math.max(0, status.volume!.level!));
    if (loadedUrl) onStatus({ ...state });
  }
  client.on("status", volumeStatus);
  try {
    await request<void>((done) =>
      client.connect({ host: target.address!, port: target.port ?? 8009 }, () =>
        done(null, undefined),
      ),
    );
    receiver = await request<DefaultMediaReceiver>((done) =>
      client.launch(DefaultMediaReceiver, done),
    );
    receiver.on("status", update);
    connected = true;
  } catch (error) {
    dispose();
    throw error;
  }
  timer = setInterval(() => {
    if (polling || closed || !loadedUrl) return;
    polling = true;
    const version = generation;
    void request<MediaStatus>((done) => receiver!.getStatus(done))
      .then((status) => {
        if (version === generation) update(status);
      })
      .catch(fail)
      .finally(() => {
        polling = false;
      });
  }, 1000);
  timer.unref();

  let sequence = Promise.resolve();
  /** 串行化媒体写入，避免延迟装载覆盖较新的会话
   * @param action - 本次媒体操作
   * @returns 本次操作完成信号
   */
  function enqueue(action: () => Promise<void>): Promise<void> {
    const next = sequence.then(async () => {
      if (closed) throw new Error("Chromecast connection closed");
      await action();
    });
    sequence = next.catch(() => {});
    return next;
  }
  /** 执行媒体会话控制
   * @param action - 控制方法
   */
  async function command(action: "play" | "pause" | "stop"): Promise<void> {
    const status = await request<MediaStatus>((done) => receiver![action](done));
    update(status);
  }
  return {
    /** 装载带有音乐元数据的媒体并恢复毫秒进度
     * @param url - 可由设备访问的媒体地址
     * @param track - 当前曲目
     * @param positionMs - 毫秒进度
     * @param autoPlay - 是否立即播放
     */
    async load(url, track, positionMs, autoPlay) {
      const version = ++generation;
      intentionalStop = true;
      await enqueue(async () => {
        if (version !== generation) return;
        loadedUrl = "";
        sessionId = undefined;
        finishedSession = undefined;
        state.durationMs = track?.duration ?? 0;
        const status = await request<MediaStatus>((done) =>
          receiver!.load(
            {
              contentId: url,
              contentType: mediaContentType(track, url),
              streamType: "BUFFERED",
              metadata: {
                metadataType: 3,
                title: track?.title ?? "SPlayer",
                artist: track?.artists.map((artist) => artist.name).join(", "),
                albumName: track?.album?.name,
              },
            },
            { autoplay: false, currentTime: Math.max(0, positionMs) / 1000 },
            done,
          ),
        );
        // 总是先暂停装载，避免停止意图被设备端延迟 LOAD 自动播放覆盖
        receiver!.media.currentSession = status;
        sessionId = status.mediaSessionId;
        loadedUrl = url;
        if (version !== generation) return;
        update(status);
        if (autoPlay && version === generation) {
          intentionalStop = false;
          await command("play");
        }
      });
    },
    /** 开始播放 */
    async play() {
      const version = generation;
      await enqueue(async () => {
        if (version !== generation) return;
        intentionalStop = false;
        await command("play");
      });
    },
    /** 暂停播放，并取消尚未完成的自动播放 */
    async pause() {
      generation++;
      intentionalStop = true;
      await enqueue(async () => {
        await command("pause");
      });
    },
    /** 停止并抑制自然结束事件 */
    async stop() {
      generation++;
      intentionalStop = true;
      await enqueue(async () => {
        await command("stop");
        loadedUrl = "";
        sessionId = undefined;
      });
    },
    /** 更新媒体进度
     * @param positionMs - 目标毫秒进度
     */
    async seek(positionMs) {
      const version = generation;
      await enqueue(async () => {
        if (version !== generation) return;
        update(
          await request<MediaStatus>((done) =>
            receiver!.seek(Math.max(0, positionMs) / 1000, done),
          ),
        );
      });
    },
    /** 更新硬件音量
     * @param volume - 零到一的音量
     */
    async setVolume(volume) {
      await request<unknown>((done) =>
        client.setVolume({ level: Math.max(0, Math.min(1, volume)) }, done),
      );
      state.volume = Math.max(0, Math.min(1, volume));
    },
    /** 释放连接且不额外改变设备播放状态 */
    async close() {
      dispose();
    },
  };
}
