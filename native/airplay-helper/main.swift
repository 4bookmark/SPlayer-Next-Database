import AppKit
import AVFoundation
import AVKit

/** 通过换行 JSON 与 Electron 通信的原生 AirPlay 播放器 */
final class AirplayHelper: NSObject, NSWindowDelegate {
    private let player = AVPlayer()
    private var panel: NSPanel!
    private var observations: [NSKeyValueObservation] = []
    private var itemObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var timeObserver: Any?
    private var desiredPlay = false
    private var volume: Float = 1
    private var generation = 0
    private var pendingLoad: Int?
    private var pendingPosition: Double = 0
    private var seekingInitial = false
    private var finished = false
    private var stopping = false

    /** 创建系统路由选择器并监听播放器状态 */
    func start() {
        player.allowsExternalPlayback = false
        player.volume = 0
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 130),
                        styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "SPlayer · AirPlay"
        panel.delegate = self
        panel.isReleasedWhenClosed = false
        let label = NSTextField(labelWithString: "Choose an AirPlay speaker")
        label.frame = NSRect(x: 24, y: 78, width: 312, height: 24)
        panel.contentView?.addSubview(label)
        let picker = AVRoutePickerView(frame: NSRect(x: 152, y: 20, width: 56, height: 48))
        picker.player = player
        panel.contentView?.addSubview(picker)
        panel.center()
        showPicker()
        observations = [
            player.observe(\.isExternalPlaybackActive, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.routeChanged() }
            },
            player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.status() }
            },
        ]
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] _ in
            self?.status()
        }
        emit(["event": "ready"])
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    DispatchQueue.main.async { self?.emit(["event": "error", "message": "Invalid AirPlay command"]) }
                    continue
                }
                DispatchQueue.main.async { self?.handle(command) }
            }
            DispatchQueue.main.async { self?.shutdown() }
        }
    }

    /** 在主线程输出单行协议消息，避免状态事件相互穿插 */
    private func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"
        FileHandle.standardOutput.write(Data(line.utf8))
    }

    /** 回复具有请求编号的命令 */
    private func reply(_ id: Int, error: String? = nil) {
        if let error { emit(["id": id, "ok": false, "error": error]) }
        else { emit(["id": id, "ok": true]) }
    }

    /** 展示 macOS 系统路由选择面板 */
    private func showPicker() {
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /** 仅在真正启用外部播放后解除静音并应用播放意图 */
    private func routeChanged() {
        if player.isExternalPlaybackActive {
            player.volume = volume
            if desiredPlay && pendingLoad == nil { player.play() }
        } else {
            player.pause()
            player.volume = 0
        }
        status()
    }

    /** 生成以毫秒为单位的播放器状态 */
    private func status() {
        let seconds = player.currentTime().seconds
        let duration = player.currentItem?.duration.seconds ?? 0
        let state: String
        if player.currentItem == nil { state = "stopped" }
        else if pendingLoad != nil || (desiredPlay && !player.isExternalPlaybackActive) { state = "loading" }
        else if player.timeControlStatus == .playing { state = "playing" }
        else if desiredPlay && player.timeControlStatus == .waitingToPlayAtSpecifiedRate { state = "loading" }
        else { state = "paused" }
        emit(["event": "status", "state": state,
              "positionMs": seconds.isFinite ? max(0, seconds * 1000) : 0,
              "durationMs": duration.isFinite ? max(0, duration * 1000) : 0,
              "volume": volume, "external": player.isExternalPlaybackActive,
              "finished": finished])
        finished = false
    }

    /** 取消旧媒体观察与未完成的加载请求，切歌时保留外部路由会话
     * @param replacing - 是否立即替换媒体而无需先清空播放器
     */
    private func clearItem(replacing: Bool = false) {
        generation += 1
        desiredPlay = false
        player.pause()
        if let id = pendingLoad { reply(id, error: "AirPlay load cancelled") }
        pendingLoad = nil
        seekingInitial = false
        itemObservation = nil
        if let observer = endObserver { NotificationCenter.default.removeObserver(observer) }
        endObserver = nil
        if !replacing { player.replaceCurrentItem(with: nil) }
    }

    /** 处理媒体就绪、失败与初始定位 */
    private func itemChanged(_ item: AVPlayerItem, token: Int) {
        guard generation == token, player.currentItem === item else { return }
        if item.status == .failed {
            let message = item.error?.localizedDescription ?? "AirPlay media failed"
            if let id = pendingLoad { reply(id, error: message); pendingLoad = nil }
            desiredPlay = false
            player.pause()
            emit(["event": "error", "message": message])
        } else if item.status == .readyToPlay, let id = pendingLoad, !seekingInitial {
            seekingInitial = true
            player.seek(to: CMTime(seconds: pendingPosition / 1000, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] success in
                DispatchQueue.main.async {
                    guard let self, self.generation == token else { return }
                    self.pendingLoad = nil
                    self.seekingInitial = false
                    if !success { self.desiredPlay = false }
                    self.reply(id, error: success ? nil : "AirPlay initial seek cancelled")
                    self.routeChanged()
                }
            }
        }
        status()
    }

    /** 执行 Electron 发来的播放命令，并保持本地输出静音 */
    private func handle(_ command: [String: Any]) {
        guard let id = command["id"] as? Int, let method = command["method"] as? String else { return }
        switch method {
        case "load":
            guard let value = command["url"] as? String, let url = URL(string: value),
                  ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") else {
                reply(id, error: "Invalid AirPlay media URL"); return
            }
            clearItem(replacing: true)
            pendingLoad = id
            pendingPosition = max(0, command["positionMs"] as? Double ?? 0)
            desiredPlay = command["autoPlay"] as? Bool ?? false
            let token = generation
            let item = AVPlayerItem(url: url)
            player.allowsExternalPlayback = true
            player.replaceCurrentItem(with: item)
            itemObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
                DispatchQueue.main.async { self?.itemChanged(item, token: token) }
            }
            endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
                guard let self, self.generation == token else { return }
                self.desiredPlay = false
                self.finished = true
                self.status()
            }
            if !player.isExternalPlaybackActive { showPicker() }
            status()
        case "play":
            desiredPlay = true
            routeChanged()
            reply(id)
        case "pause":
            desiredPlay = false
            player.pause()
            status()
            reply(id)
        case "stop":
            clearItem()
            status()
            reply(id)
        case "seek":
            guard let position = command["positionMs"] as? Double, position.isFinite, position >= 0 else {
                reply(id, error: "Invalid AirPlay position"); return
            }
            let token = generation
            player.seek(to: CMTime(seconds: position / 1000, preferredTimescale: 600)) { [weak self] success in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.reply(id, error: success && self.generation == token ? nil : "AirPlay seek cancelled")
                    self.status()
                }
            }
        case "setVolume":
            guard let value = command["volume"] as? Double, value.isFinite else {
                reply(id, error: "Invalid AirPlay volume"); return
            }
            volume = Float(min(1, max(0, value)))
            player.volume = player.isExternalPlaybackActive ? volume : 0
            status()
            reply(id)
        case "close":
            reply(id)
            shutdown()
        default:
            reply(id, error: "Unknown AirPlay command")
        }
    }

    /** 用户关闭尚未选定路由的面板时通知主进程取消连接 */
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if !player.isExternalPlaybackActive && !stopping {
            clearItem()
            emit(["event": "error", "message": "AirPlay route selection cancelled"])
        }
        return true
    }

    /** 释放观察与播放器并退出辅助进程 */
    private func shutdown() {
        stopping = true
        clearItem()
        observations.removeAll()
        if let observer = timeObserver { player.removeTimeObserver(observer) }
        timeObserver = nil
        panel.close()
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let helper = AirplayHelper()
helper.start()
app.run()
