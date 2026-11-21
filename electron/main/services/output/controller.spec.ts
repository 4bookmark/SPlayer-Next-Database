// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  gate: undefined as Promise<void> | undefined,
  status: undefined as ((value: unknown) => void) | undefined,
  error: undefined as ((value: string) => void) | undefined,
  backend: {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    close: vi.fn(),
  },
}));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: vi.fn() }));
vi.mock("@main/utils/logger", () => ({ playerLog: { warn: vi.fn() } }));
vi.mock("./mediaBridge", () => ({
  publishMedia: async () => ({ url: "http://10.0.0.1/media/temporary", revoke: vi.fn() }),
  closeMediaBridge: vi.fn(),
}));
vi.mock("./discovery", () => ({
  scanOutputTargets: async () => [
    { id: "cast:1", name: "TV", protocol: "chromecast", address: "10.0.0.2" },
  ],
}));
vi.mock("./chromecast", () => ({
  createChromecastBackend: async (
    _target: unknown,
    status: (value: unknown) => void,
    error: (value: string) => void,
  ) => {
    await mock.gate;
    mock.status = status;
    mock.error = error;
    return mock.backend;
  },
}));
vi.mock("./upnp", () => ({ createUpnpBackend: vi.fn() }));
vi.mock("./airplay", () => ({ createAirplayBackend: vi.fn() }));

beforeEach(() => {
  mock.gate = undefined;
  vi.resetModules();
  vi.clearAllMocks();
  for (const fn of Object.values(mock.backend)) fn.mockResolvedValue(undefined);
});

/** 构造不访问真实声卡的本机引擎 */
const native = () => ({
  load: vi.fn(async () => ({})),
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  pauseImmediately: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(async () => {}),
  setVolume: vi.fn(),
  setFftEnabled: vi.fn(),
  getStatus: () => ({
    state: "playing",
    position: 2,
    duration: 10,
    volume: 0.4,
    isFinished: false,
  }),
  getPosition: () => 2,
  getDuration: () => 10,
  getVolume: () => 0.4,
  onEvent: vi.fn(),
});

describe("统一远程输出", () => {
  it("接管所有播放控制与状态，切回本机恢复当前位置", async () => {
    const mod = await import("./controller");
    const engine = native();
    const player = mod.createOutputFacade(engine as never);
    await player.load("/music/song.flac", true);
    await mod.scanOutputs();
    await mod.selectOutput("cast:1");
    expect(engine.pauseImmediately).toHaveBeenCalled();
    expect(mock.backend.load).toHaveBeenCalledWith(
      expect.stringContaining("/media/"),
      undefined,
      2000,
      true,
    );
    mock.status!({
      state: "playing",
      positionMs: 6000,
      durationMs: 10000,
      volume: 0.3,
      external: true,
    });
    expect(player.getPosition()).toBe(6);
    await player.pause();
    await player.seek(3);
    player.setVolume(0.2);
    await player.play();
    expect(mock.backend.seek).toHaveBeenCalledWith(3000);
    expect(mock.backend.setVolume).toHaveBeenLastCalledWith(0.2);
    expect(player.getStatus().state).toBe("playing");
    await mod.selectOutput("local");
    expect(mock.backend.stop).toHaveBeenCalled();
    expect(mock.backend.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mock.backend.close.mock.invocationCallOrder[0]!,
    );
    expect(mock.backend.close).toHaveBeenCalled();
    expect(engine.seek).toHaveBeenLastCalledWith(3);
    expect(engine.setVolume).toHaveBeenLastCalledWith(0.2);
    mod.closeOutputs();
  });
  it("自然结束只触发一次，接管期间忽略本机结束事件", async () => {
    const mod = await import("./controller");
    const engine = native();
    const player = mod.createOutputFacade(engine as never);
    const event = vi.fn();
    player.onEvent(event);
    await player.load("/music/song.flac");
    await mod.scanOutputs();
    await mod.selectOutput("cast:1");
    engine.onEvent.mock.calls[0]![0]({ type: "ended" });
    expect(event).not.toHaveBeenCalledWith({ type: "ended" });
    mock.status!({
      state: "stopped",
      positionMs: 10000,
      durationMs: 10000,
      volume: 1,
      external: true,
      finished: true,
    });
    mock.status!({
      state: "stopped",
      positionMs: 10000,
      durationMs: 10000,
      volume: 1,
      external: true,
      finished: true,
    });
    expect(event.mock.calls.filter(([e]) => e.type === "ended")).toHaveLength(1);
    mod.closeOutputs();
  });
  it("连接失败恢复本机且界面报告错误", async () => {
    const mod = await import("./controller");
    const engine = native();
    const player = mod.createOutputFacade(engine as never);
    await player.load("/music/song.flac");
    await mod.scanOutputs();
    mock.backend.load.mockRejectedValueOnce(new Error("receiver refused"));
    await expect(mod.selectOutput("cast:1")).rejects.toThrow("receiver refused");
    expect(mod.getOutputState().activeId).toBe("local");
    expect(engine.play).toHaveBeenCalled();
    expect(mod.getOutputState().error).toBeTruthy();
    mod.closeOutputs();
  });
  it("连接期间暂停与跳转只更新远端意图，不唤醒本机扬声器", async () => {
    let release!: () => void;
    mock.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mod = await import("./controller");
    const engine = native();
    const player = mod.createOutputFacade(engine as never);
    await player.load("/music/song.flac");
    await mod.scanOutputs();
    const selecting = mod.selectOutput("cast:1");
    await player.play();
    player.pause();
    await player.seek(4);
    player.setVolume(0.15);
    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.pause).not.toHaveBeenCalled();
    release();
    await selecting;
    expect(mock.backend.load).toHaveBeenCalledWith(expect.any(String), undefined, 4000, false);
    expect(mock.backend.setVolume).toHaveBeenCalledWith(0.15);
    mod.closeOutputs();
  });
  it("连接期间停止会取消接管，迟到的连接不得启动音频", async () => {
    let release!: () => void;
    mock.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mod = await import("./controller");
    const engine = native();
    const player = mod.createOutputFacade(engine as never);
    await player.load("/music/song.flac");
    await mod.scanOutputs();
    const selecting = mod.selectOutput("cast:1");
    player.stop();
    release();
    await selecting;
    expect(engine.play).not.toHaveBeenCalled();
    expect(mock.backend.load).not.toHaveBeenCalled();
    expect(mock.backend.close).toHaveBeenCalled();
    expect(mod.getOutputState()).toMatchObject({ activeId: "local", connecting: false });
    mod.closeOutputs();
  });
  it("取消或失败后忽略迟到状态，同一目标可以直接重试", async () => {
    const mod = await import("./controller");
    const player = mod.createOutputFacade(native() as never);
    await player.load("/music/song.flac");
    await mod.scanOutputs();
    await mod.selectOutput("cast:1");
    mock.error!("route selection cancelled");
    mock.status!({
      state: "playing",
      positionMs: 9000,
      durationMs: 10000,
      volume: 1,
      external: true,
    });
    expect(player.getStatus().state).toBe("stopped");
    await mod.selectOutput("cast:1");
    expect(mock.backend.load).toHaveBeenCalledTimes(2);
    expect(mod.getOutputState().error).toBeUndefined();
    mod.closeOutputs();
  });
  it("初次远端加载被下一首取代时保留输出，不恢复本机播放", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.backend.load.mockImplementationOnce(() => held);
    const mod = await import("./controller");
    const engine = native();
    const player = mod.createOutputFacade(engine as never);
    await player.load("/music/first.flac");
    await mod.scanOutputs();
    const selecting = mod.selectOutput("cast:1");
    await vi.waitFor(() => expect(mock.backend.load).toHaveBeenCalledTimes(1));
    await player.load("/music/next.flac");
    release();
    await selecting;
    expect(mod.getOutputState().activeId).toBe("cast:1");
    expect(mock.backend.close).not.toHaveBeenCalled();
    expect(mock.backend.stop).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
    mod.closeOutputs();
  });
  it("连接失败回退时恢复当前歌曲与音量，遵守连接中最后的暂停意图", async () => {
    const mod = await import("./controller");
    const engine = native();
    const player = mod.createOutputFacade(engine as never);
    await player.load("/music/old.flac");
    await mod.scanOutputs();
    await mod.selectOutput("cast:1");
    await player.load("/music/current.flac");
    let fail!: (error: Error) => void;
    mock.backend.load.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    mock.error!("receiver lost");
    const retry = mod.selectOutput("cast:1");
    await vi.waitFor(() => expect(mock.backend.load).toHaveBeenCalledTimes(3));
    player.pause();
    player.setVolume(0.1);
    fail(new Error("retry refused"));
    await expect(retry).rejects.toThrow("retry refused");
    expect(engine.load).toHaveBeenLastCalledWith("/music/current.flac", false);
    expect(engine.setVolume).toHaveBeenLastCalledWith(0.1);
    expect(engine.play).not.toHaveBeenCalled();
    mod.closeOutputs();
  });
  it("回到本机的重新加载期间按暂停，不会被随后完成的恢复操作覆盖", async () => {
    const mod = await import("./controller");
    const engine = native();
    const player = mod.createOutputFacade(engine as never);
    await player.load("/music/song.flac");
    await mod.scanOutputs();
    await mod.selectOutput("cast:1");
    mock.status!({
      state: "playing",
      positionMs: 4000,
      durationMs: 10000,
      volume: 0.2,
      external: true,
    });
    let release!: () => void;
    engine.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    );
    const switching = mod.selectOutput("local");
    await vi.waitFor(() => expect(engine.load).toHaveBeenCalledTimes(2));
    player.pause();
    release();
    await switching;
    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.setVolume).toHaveBeenLastCalledWith(0.2);
    mod.closeOutputs();
  });
});
