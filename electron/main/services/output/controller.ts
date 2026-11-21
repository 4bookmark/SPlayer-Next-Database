import type { AudioPlayer, JsMusicMetadata, JsPlayerEvent } from "@splayer/audio-engine";
import type { Track } from "@shared/types/player";
import type {
  OutputTarget,
  OutputState,
  OutputPlaybackStatus,
  RemoteOutputBackend,
} from "@shared/types/output";
import { sendToMain } from "@main/utils/broadcast";
import { playerLog } from "@main/utils/logger";
import { publishMedia, closeMediaBridge } from "./mediaBridge";
import { scanOutputTargets } from "./discovery";
import { createUpnpBackend } from "./upnp";
import { createChromecastBackend } from "./chromecast";
import { createAirplayBackend } from "./airplay";

const LOCAL: OutputTarget = { id: "local", name: "此 Mac", protocol: "local" };
let targets: OutputTarget[] = [LOCAL];
let selected: OutputTarget | undefined;
let backend: RemoteOutputBackend | undefined;
let local: AudioPlayer | undefined;
let listener: ((event: JsPlayerEvent) => void) | undefined;
let lastTrack: Track | undefined;
let lastSource = "";
let status: OutputPlaybackStatus = {
  state: "stopped",
  positionMs: 0,
  durationMs: 0,
  volume: 1,
  external: false,
};
let scanning = false;
let connecting = false;
let errorMessage: string | undefined;
let epoch = 0;
let loadEpoch = 0;
let ended = false;
let revokeMedia: (() => void) | undefined;
let connectionReady: Promise<RemoteOutputBackend> | undefined;
let playIntent = false;
let failed = false;
let localFftEnabled = false;

/** 当前可用设备与活动输出状态 */
export const getOutputState = (): OutputState => ({
  targets: [...targets],
  activeId: selected?.id ?? "local",
  scanning,
  connecting,
  error: errorMessage,
});

/** 同步设备面板状态，避免另建轮询 */
const publish = (): void => sendToMain("output:state", getOutputState());

/** 记录已解析音源对应的元数据，保持远端播放身份 */
export const setOutputTrack = (track: Track | undefined): void => {
  lastTrack = track;
};

/** 是否由远程输出接管，供预加载和本机专有处理判断 */
export const isRemoteOutput = (): boolean => Boolean(selected);

/** 避免错误信息包含上游媒体 URL 或鉴权参数 */
const safeError = (message: string): string =>
  message.replace(/https?:\/\/[^\s)]+/gi, "[媒体地址]");

/** 汇入现有播放事件链，统一系统媒体键、MCP 与队列下一曲 */
const receiveStatus = (next: OutputPlaybackStatus): void => {
  if (failed) return;
  const previousState = status.state;
  status = next;
  const previousConnecting = connecting;
  connecting = !next.external && selected?.protocol === "airplay";
  if (previousState !== next.state) listener?.({ type: "stateChanged", state: next.state });
  listener?.({
    type: "position",
    position: next.positionMs / 1000,
    duration: next.durationMs / 1000,
  });
  if (next.finished && !ended) {
    ended = true;
    listener?.({ type: "ended" });
  }
  if (previousConnecting !== connecting) publish();
};

/** 远端失败后停止当前会话，保留目标供用户重试或切回本机 */
const reportError = (message: string): void => {
  failed = true;
  errorMessage = safeError(message);
  playerLog.warn(`远程输出失败: ${errorMessage}`);
  connecting = false;
  status = { ...status, state: "stopped", external: false };
  listener?.({ type: "stateChanged", state: "stopped" });
  publish();
};

/** 完成原有播放器所需的元数据结构，音频由接收端解码 */
const metadata = (track = lastTrack): JsMusicMetadata => ({
  title: track?.title,
  artist: track?.artists.map((a) => a.name).join(" / "),
  album: track?.album?.name,
  duration: (track?.duration ?? status.durationMs) / 1000,
  sampleRate: track?.quality?.sampleRate ?? 0,
  originalSampleRate: track?.quality?.sampleRate ?? 0,
  channels: track?.quality?.channels ?? 0,
  bitsPerSample: track?.quality?.bitsPerSample ?? 0,
  bitRate: track?.quality?.bitRate ?? 0,
  codec: track?.quality?.codec ?? "",
  externalLyrics: [],
});

/** 将当前已解析音源交给活动接收端，过期加载不得提交 */
const loadRemote = async (
  source: string,
  autoPlay: boolean,
  positionMs = 0,
): Promise<JsMusicMetadata> => {
  if (!backend || !selected) throw new Error("未连接播放设备");
  if (lastTrack?.cuePath) throw new Error("远程播放暂不支持 CUE 分轨，请切回此 Mac");
  failed = false;
  errorMessage = undefined;
  const current = backend;
  const track = lastTrack;
  const seq = ++loadEpoch;
  const session = epoch;
  lastSource = source;
  ended = false;
  const lease = await publishMedia(
    source,
    track,
    selected.protocol === "airplay" ? undefined : selected.address,
  );
  if (seq !== loadEpoch || session !== epoch) {
    lease.revoke();
    throw new Error("[Cancelled]");
  }
  const previousRevoke = revokeMedia;
  revokeMedia = lease.revoke;
  status = {
    ...status,
    state: "loading",
    positionMs,
    durationMs: track?.duration ?? 0,
    finished: false,
  };
  try {
    await current.load(lease.url, track, positionMs, autoPlay);
    if (seq !== loadEpoch || session !== epoch) throw new Error("[Cancelled]");
    previousRevoke?.();
    return metadata(track);
  } catch (error) {
    lease.revoke();
    previousRevoke?.();
    if (seq === loadEpoch && session === epoch) reportError(String(error));
    throw error;
  }
};

/** 定时有界发现并保留正在播放的离线目标以便展示错误 */
export const scanOutputs = async (): Promise<OutputState> => {
  if (scanning) return getOutputState();
  scanning = true;
  errorMessage = undefined;
  publish();
  try {
    const found = await scanOutputTargets((message) => playerLog.info(message));
    targets = [LOCAL, ...found];
    if (selected && !targets.some((t) => t.id === selected!.id)) targets.push(selected);
  } catch (error) {
    errorMessage = safeError(String(error));
  } finally {
    scanning = false;
    publish();
  }
  return getOutputState();
};

/** 切换到指定目标；创建失败后恢复本机原有进度与播放状态 */
export const selectOutput = async (id: string): Promise<OutputState> => {
  if (id === (selected?.id ?? "local") && !failed) return getOutputState();
  const target = targets.find((t) => t.id === id);
  if (!target) throw new Error("播放设备已不在列表，请重新扫描");
  if (!local) throw new Error("播放器尚未初始化");
  const session = ++epoch;
  ++loadEpoch;
  const previous = selected
    ? { ...status }
    : {
        state: local.getStatus().state,
        positionMs: local.getPosition() * 1000,
        durationMs: local.getDuration() * 1000,
        volume: local.getVolume(),
      };
  const wasPlaying = previous.state === "playing";
  playIntent = wasPlaying;
  const old = backend;
  backend = undefined;
  selected = id === "local" ? undefined : target;
  let resolveConnection: (value: RemoteOutputBackend) => void = () => {};
  let rejectConnection: (error: Error) => void = () => {};
  connectionReady = selected
    ? new Promise<RemoteOutputBackend>((resolve, reject) => {
        resolveConnection = resolve;
        rejectConnection = reject;
      })
    : undefined;
  void connectionReady?.catch(() => {});
  const beforeConnectLoad = loadEpoch;
  failed = false;
  errorMessage = undefined;
  connecting = id !== "local";
  status = { ...status, ...previous, state: "loading", external: false, finished: false };
  local.pauseImmediately();
  publish();
  if (old) {
    await old.stop().catch(() => {});
    await old.close().catch(() => {});
  }
  if (session !== epoch) {
    rejectConnection(new Error("[Cancelled]"));
    return getOutputState();
  }
  revokeMedia?.();
  revokeMedia = undefined;
  if (id === "local") {
    connecting = false;
    local.setVolume(previous.volume);
    local.setFftEnabled(localFftEnabled);
    if (lastSource) {
      await local.load(lastSource, false);
      if (session !== epoch) return getOutputState();
      await local.seek(previous.positionMs / 1000);
      if (playIntent) await local.play();
    }
    publish();
    return getOutputState();
  }
  try {
    const onStatus = (value: OutputPlaybackStatus): void => {
      if (session === epoch) receiveStatus(value);
    };
    const onError = (message: string): void => {
      if (session === epoch) reportError(message);
    };
    const pending = await (target.protocol === "airplay"
      ? createAirplayBackend(onStatus, onError)
      : target.protocol === "chromecast"
        ? createChromecastBackend(target, onStatus, onError)
        : createUpnpBackend(target, onStatus, onError));
    if (session !== epoch) {
      rejectConnection(new Error("[Cancelled]"));
      await pending.close();
      return getOutputState();
    }
    backend = pending;
    resolveConnection(pending);
    await pending.setVolume(status.volume).catch((error) => {
      playerLog.warn(`设备音量不可用: ${safeError(String(error))}`);
    });
    if (session !== epoch) return getOutputState();
    if (lastSource && beforeConnectLoad === loadEpoch)
      await loadRemote(lastSource, playIntent, status.positionMs);
    if (session === epoch) {
      connecting = target.protocol === "airplay" && !status.external;
      publish();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "[Cancelled]") return getOutputState();
    rejectConnection(error instanceof Error ? error : new Error(String(error)));
    if (session === epoch) {
      const rejectedBackend = backend;
      await rejectedBackend?.stop().catch(() => {});
      await rejectedBackend?.close().catch(() => {});
      if (session !== epoch) return getOutputState();
      backend = undefined;
      selected = undefined;
      connecting = false;
      failed = true;
      errorMessage = safeError(String(error));
      local.setVolume(status.volume);
      local.setFftEnabled(localFftEnabled);
      if (lastSource) {
        try {
          await local.load(lastSource, false);
          if (session !== epoch) return getOutputState();
          await local.seek(status.positionMs / 1000);
          if (session !== epoch) return getOutputState();
          if (playIntent) await local.play();
        } catch (recoveryError) {
          playerLog.warn(`恢复本机输出失败: ${safeError(String(recoveryError))}`);
        }
      }
      publish();
    }
    throw new Error(safeError(String(error)));
  }
  return getOutputState();
};

/** 回收原生与网络输出会话，应用退出时不遗留音频连接 */
export const closeOutputs = (): void => {
  epoch++;
  loadEpoch++;
  const current = backend;
  if (current)
    void current
      .stop()
      .catch(() => {})
      .finally(() => current.close().catch(() => {}));
  backend = undefined;
  selected = undefined;
  revokeMedia?.();
  revokeMedia = undefined;
  closeMediaBridge();
};

/** 在原生实例外统一分发已存在的播放器控制入口 */
export const createOutputFacade = (native: AudioPlayer): AudioPlayer => {
  local = native;
  const remoteCommand = (command: Promise<void>): void => {
    const session = epoch;
    void command.catch((error) => {
      if (session === epoch) reportError(String(error));
    });
  };
  const overrides: Partial<AudioPlayer> = {
    onEvent(callback) {
      listener = callback;
      native.onEvent((event) => {
        if (!selected) callback(event);
      });
    },
    async load(source, autoPlay = true, preparedId) {
      lastSource = source;
      playIntent = autoPlay;
      if (selected) {
        const session = epoch;
        const request = ++loadEpoch;
        if (!backend) await connectionReady;
        if (session !== epoch || request !== loadEpoch) throw new Error("[Cancelled]");
        return loadRemote(source, playIntent);
      }
      return native.load(source, autoPlay, preparedId);
    },
    async play() {
      playIntent = true;
      if (selected) {
        if (backend) await backend.play();
      } else await native.play();
    },
    pause() {
      playIntent = false;
      if (selected) {
        if (backend) remoteCommand(backend.pause());
      } else native.pause();
    },
    pauseImmediately() {
      playIntent = false;
      if (selected) {
        if (backend) remoteCommand(backend.pause());
      } else native.pauseImmediately();
    },
    stop() {
      playIntent = false;
      if (selected) {
        loadEpoch++;
        ended = true;
        if (backend) remoteCommand(backend.stop());
        else {
          epoch++;
          selected = undefined;
          connectionReady = undefined;
          connecting = false;
          native.stop();
          publish();
        }
      } else native.stop();
    },
    async seek(seconds) {
      if (selected) {
        status = { ...status, positionMs: seconds * 1000 };
        if (backend) await backend.seek(seconds * 1000);
      } else await native.seek(seconds);
    },
    setVolume(volume) {
      if (selected) {
        status = { ...status, volume };
        if (backend) remoteCommand(backend.setVolume(volume));
      } else native.setVolume(volume);
    },
    getVolume() {
      return selected ? status.volume : native.getVolume();
    },
    getPosition() {
      return selected ? status.positionMs / 1000 : native.getPosition();
    },
    getDuration() {
      return selected ? status.durationMs / 1000 : native.getDuration();
    },
    getStatus() {
      return selected
        ? {
            state: status.state,
            position: status.positionMs / 1000,
            duration: status.durationMs / 1000,
            volume: status.volume,
            isFinished: Boolean(status.finished),
          }
        : native.getStatus();
    },
    getSpeed() {
      return selected ? 1 : native.getSpeed();
    },
    getPitch() {
      return selected ? 0 : native.getPitch();
    },
    getCoverRaw() {
      return selected ? null : native.getCoverRaw();
    },
    getFftData() {
      return selected ? { ldata: [], rdata: [] } : native.getFftData();
    },
    setSpeed(value) {
      if (!selected) native.setSpeed(value);
    },
    setPitch(value) {
      if (!selected) native.setPitch(value);
    },
    setFftEnabled(value) {
      localFftEnabled = value;
      native.setFftEnabled(selected ? false : value);
    },
    async reinitOutput() {
      if (!selected) await native.reinitOutput();
    },
  };
  return new Proxy(native, {
    get(target, property) {
      const override = Reflect.get(overrides, property);
      if (override !== undefined) return override;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};
