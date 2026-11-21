import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { app } from "electron";
import { nativeLog } from "@main/utils/logger";
import type {
  OutputPlaybackStatus,
  OutputStatusListener,
  RemoteOutputBackend,
} from "@shared/types/output";

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 启动 macOS 原生路由面板与 AVPlayer，所有媒体命令通过有界请求传递
 * @param onStatus - 外部路由与播放进度监听
 * @param onError - 路由取消、媒体失败与进程异常监听
 * @returns 原生 AirPlay 播放后端
 */
export async function createAirplayBackend(
  onStatus: OutputStatusListener,
  onError: (message: string) => void,
): Promise<RemoteOutputBackend> {
  if (process.platform !== "darwin") throw new Error("AirPlay requires macOS");
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, "airplay-helper")
    : path.join(app.getAppPath(), "native", "airplay-helper", "airplay-helper");
  await access(executable, constants.X_OK);
  const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const errors = createInterface({ input: child.stderr });
  const pending = new Map<number, PendingRequest>();
  let nextId = 0;
  let closing = false;
  let disposed = false;
  let ready = false;
  let rejectStartup: (error: Error) => void = () => {};
  let resolveStartup: () => void = () => {};
  const startup = new Promise<void>((resolve, reject) => {
    resolveStartup = resolve;
    rejectStartup = reject;
  });
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const startupTimer = setTimeout(() => fail("AirPlay helper startup timed out"), 8_000);

  /** 拒绝全部未完成请求并撤销协议监听 */
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearTimeout(startupTimer);
    if (killTimer) clearTimeout(killTimer);
    lines.close();
    errors.close();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("AirPlay helper closed"));
    }
    pending.clear();
    rejectStartup(new Error("AirPlay helper closed"));
  }

  /** 终止辅助进程并设置强制退出上限，避免 AVFoundation 卡住后遗留进程 */
  function terminate(): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 1_000);
    killTimer.unref();
  }

  /**
   * 统一处理不可恢复的协议或进程错误
   * @param message - 可呈现给用户的错误信息
   */
  function fail(message: string): void {
    if (disposed) return;
    const notify = !closing;
    closing = true;
    rejectStartup(new Error(message));
    dispose();
    terminate();
    if (notify) onError(message);
  }

  /**
   * 写入一个带超时的 JSON 请求
   * @param method - 原生命令名
   * @param parameters - 命令参数
   * @returns 原生处理完成后的通知
   */
  function request(method: string, parameters: Record<string, unknown> = {}): Promise<void> {
    if (disposed || (closing && method !== "close")) {
      return Promise.reject(new Error("AirPlay helper closed"));
    }
    if (pending.size >= 32) return Promise.reject(new Error("Too many pending AirPlay commands"));
    const id = ++nextId;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          pending.delete(id);
          reject(new Error(`AirPlay ${method} timed out`));
          fail(`AirPlay ${method} timed out`);
        },
        method === "load" ? 20_000 : 5_000,
      );
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, ...parameters })}\n`, (error) => {
        if (error) fail(`AirPlay command failed: ${error.message}`);
      });
    });
  }

  lines.on("line", (line) => {
    if (disposed) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
      if (!message || typeof message !== "object") throw new Error("Invalid message");
    } catch {
      fail("Invalid response from AirPlay helper");
      return;
    }
    if (typeof message.id === "number") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok === true) entry.resolve();
      else entry.reject(new Error(String(message.error || "AirPlay command failed")));
    } else if (message.event === "ready") {
      ready = true;
      clearTimeout(startupTimer);
      resolveStartup();
    } else if (message.event === "error") {
      if (!closing) onError(String(message.message || "AirPlay playback failed"));
    } else if (message.event === "status" && !closing) {
      const { state, positionMs, durationMs, volume, external, finished } = message;
      if (
        (state === "idle" ||
          state === "loading" ||
          state === "playing" ||
          state === "paused" ||
          state === "stopped") &&
        typeof positionMs === "number" &&
        Number.isFinite(positionMs) &&
        typeof durationMs === "number" &&
        Number.isFinite(durationMs) &&
        typeof volume === "number" &&
        Number.isFinite(volume) &&
        typeof external === "boolean"
      ) {
        const status: OutputPlaybackStatus = {
          state,
          positionMs,
          durationMs,
          volume,
          external,
          finished: finished === true,
        };
        onStatus(status);
      }
    }
  });
  errors.on("line", (line) => nativeLog.debug(`[AirPlay] ${line.slice(0, 2_000)}`));
  child.stdin.on("error", (error) => fail(`AirPlay input failed: ${error.message}`));
  child.on("error", (error) => fail(`AirPlay helper failed: ${error.message}`));
  child.on("exit", (code, signal) => {
    if (!closing) fail(`AirPlay helper exited (${signal || code})`);
    dispose();
    if (killTimer) clearTimeout(killTimer);
  });

  try {
    await startup;
  } catch (error) {
    dispose();
    terminate();
    throw error;
  }
  if (!ready || disposed) throw new Error("AirPlay helper unavailable");

  return {
    /** 加载媒体并在系统外部路由激活后应用播放意图 */
    load: (url, _track, positionMs, autoPlay) => request("load", { url, positionMs, autoPlay }),
    /** 请求播放，尚未选定外部路由时保持等待 */
    play: () => request("play"),
    /** 暂停媒体并清除自动播放意图 */
    pause: () => request("pause"),
    /** 停止播放并取消未完成的媒体加载 */
    stop: () => request("stop"),
    /** 按毫秒定位当前媒体 */
    seek: (positionMs) => request("seek", { positionMs }),
    /** 设置零到一之间的输出音量 */
    setVolume: (volume) => request("setVolume", { volume }),
    /** 关闭播放器与系统路由面板并回收辅助进程 */
    async close() {
      if (closing || disposed) return;
      closing = true;
      try {
        await request("close");
      } catch {
        // 关闭过程中进程退出会自然拒绝请求，仍需继续释放句柄
      } finally {
        dispose();
        child.stdin.end();
        terminate();
      }
    },
  };
}
