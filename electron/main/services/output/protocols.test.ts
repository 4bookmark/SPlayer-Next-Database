import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { XMLParser } from "fast-xml-parser";
import type { Client, MediaStatus, Callback } from "castv2-client";
import type { Track } from "@shared/types/player";
import type { OutputPlaybackStatus } from "@shared/types/output";
import { describeRenderer } from "./discovery";
import { connectCastBackend } from "./chromecast";
import {
  createUpnpBackend,
  mediaContentType,
  parseUpnpTime,
  trackMetadata,
  resolveSonosCoordinator,
  escapeXml,
} from "./upnp";

const track = {
  id: "1",
  source: "local",
  title: 'A < B & "C"',
  artists: [{ id: "1", name: "Artist & Co" }],
  duration: 10000,
  path: "/music/test.flac",
} as Track;

test("token URLs use actual media format and DIDL round-trips escaped metadata", () => {
  const url = "http://127.0.0.1/token?x=1&y=2";
  assert.equal(mediaContentType(track, url), "audio/flac");
  const item = new XMLParser({ removeNSPrefix: true }).parse(trackMetadata(url, track))["DIDL-Lite"]
    .item;
  assert.equal(item.title, track.title);
  assert.equal(item.res, url);
  assert.equal(parseUpnpTime("01:02:03.500"), 3723500);
  assert.equal(parseUpnpTime("NOT_IMPLEMENTED"), 0);
});

test("Sonos discovery keeps root UUID and control follows existing group coordinator", async (t) => {
  const requests: { path: string; body: string; action: string }[] = [];
  let base = "";
  let transportState = "STOPPED";
  let position = "00:00:09";
  const events = new EventEmitter();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const action =
      String(req.headers.soapaction ?? "")
        .split("#")[1]
        ?.replace(/"/g, "") ?? "";
    requests.push({ path: req.url!, body, action });
    res.setHeader("content-type", "text/xml");
    if (req.url === "/description") {
      res.end(
        `<root><device><deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><manufacturer>Sonos</manufacturer><UDN>uuid:RINCON_MEMBER</UDN><friendlyName>192.0.2.16 - Sonos One - RINCON_MEMBER</friendlyName><roomName>示例房间</roomName><deviceList><device><UDN>uuid:RINCON_MEMBER_MR</UDN><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/member/av</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/member/rc</controlURL></service></serviceList></device></deviceList></device></root>`,
      );
      return;
    }
    const response =
      action === "GetZoneGroupState"
        ? `<ZoneGroupState>${escapeXml(`<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator="RINCON_COORD" ID="RINCON_COORD:1"><ZoneGroupMember UUID="RINCON_MEMBER" Location="${base}/member.xml" ZoneName="示例房间" Configuration="1" SWGen="2" /><ZoneGroupMember UUID="RINCON_COORD" Location="${base}/coordinator.xml" ZoneName="示例协调器" Configuration="1" SWGen="2" /></ZoneGroup></ZoneGroups><VanishedDevices /></ZoneGroupState>`)}</ZoneGroupState>`
        : action === "GetTransportInfo"
          ? `<CurrentTransportState>${transportState}</CurrentTransportState>`
          : action === "GetPositionInfo"
            ? `<RelTime>${position}</RelTime><TrackDuration>00:00:10</TrackDuration><TrackURI>${base}/token</TrackURI>`
            : "";
    res.end(
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:test">${response}</u:${action}Response></s:Body></s:Envelope>`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const [target] = await describeRenderer(`${base}/description`, AbortSignal.timeout(2000));
  assert.equal(target.id, "sonos:RINCON_MEMBER");
  assert.equal(target.name, "示例房间");
  const backend = await createUpnpBackend(
    target,
    (status) => events.emit("status", status),
    (error) => assert.fail(error),
  );
  t.after(() => backend.close());
  await backend.load(`${base}/token`, track, 3200, false);
  await backend.play();
  await backend.setVolume(0.25);
  transportState = "PLAYING";
  await once(events, "status", { signal: AbortSignal.timeout(2500) });
  transportState = "STOPPED";
  position = "00:00:00";
  const [ended] = await once(events, "status", { signal: AbortSignal.timeout(2500) });
  assert.equal(ended.finished, true);
  await backend.stop();
  await backend.close();
  assert(
    requests.some(
      (request) =>
        request.path === "/MediaRenderer/AVTransport/Control" &&
        request.action === "SetAVTransportURI",
    ),
  );
  assert(
    requests.some((request) => request.action === "Seek" && request.body.includes("00:00:03")),
  );
  assert(
    requests.some(
      (request) =>
        request.path === "/MediaRenderer/RenderingControl/Control" &&
        request.body.includes("<DesiredVolume>25</DesiredVolume>"),
    ),
  );
  assert(
    !requests.some((request) =>
      /BecomeCoordinator|CreateStereoPair|DelegateGroupCoordination/.test(request.action),
    ),
  );
});

class FakeReceiver extends EventEmitter {
  media: { currentSession: MediaStatus | null } = { currentSession: null };
  lastMedia?: Record<string, unknown>;
  options?: { autoplay: boolean; currentTime: number };
  /** 模拟 Cast 媒体装载回调 */
  load(
    media: Record<string, unknown>,
    options: { autoplay: boolean; currentTime: number },
    done: Callback,
  ): void {
    this.lastMedia = media;
    this.options = options;
    const status = {
      mediaSessionId: 1,
      playerState: options.autoplay ? "PLAYING" : "PAUSED",
      currentTime: options.currentTime,
      media: { contentId: String(media.contentId), duration: 10 },
    };
    this.media.currentSession = status;
    done(null, status);
  }
  /** 模拟播放回调 */
  play(done: Callback): void {
    done(null, { ...this.media.currentSession!, playerState: "PLAYING" });
  }
  /** 模拟暂停回调 */
  pause(done: Callback): void {
    done(null, { ...this.media.currentSession!, playerState: "PAUSED" });
  }
  /** 模拟媒体停止回调 */
  stop(done: Callback): void {
    done(null, { mediaSessionId: 1, playerState: "IDLE", idleReason: "CANCELLED" });
  }
}
class FakeClient extends EventEmitter {
  client = new EventEmitter();
  receiver = new FakeReceiver();
  closed = false;
  /** 模拟连接建立 */
  connect(_options: unknown, done: () => void): void {
    done();
  }
  /** 模拟默认接收器启动 */
  launch(_type: unknown, done: Callback<FakeReceiver>): void {
    done(null, this.receiver);
  }
  /** 模拟底层连接释放 */
  close(): void {
    this.closed = true;
    this.client.emit("close");
  }
}

test("Cast uses paused load, milliseconds, natural FINISHED once, and suppresses manual stop", async () => {
  const client = new FakeClient();
  const statuses: OutputPlaybackStatus[] = [];
  const backend = await connectCastBackend(
    client as unknown as Client,
    { id: "chromecast:1", name: "Cast", protocol: "chromecast", address: "127.0.0.1" },
    (status) => statuses.push(status),
    (message) => assert.fail(message),
  );
  assert.equal(client.receiver.lastMedia, undefined);
  await backend.load("http://127.0.0.1/token", track, 2500, false);
  assert.deepEqual(client.receiver.options, { autoplay: false, currentTime: 2.5 });
  assert.equal(
    (client.receiver.lastMedia as Record<string, unknown> | undefined)?.contentType,
    "audio/flac",
  );
  assert.equal(statuses.at(-1)?.positionMs, 2500);
  await backend.load("http://127.0.0.1/token", track, 0, true);
  const finished = { mediaSessionId: 1, playerState: "IDLE", idleReason: "FINISHED" };
  client.receiver.emit("status", finished);
  client.receiver.emit("status", finished);
  assert.equal(statuses.filter((status) => status.finished).length, 1);
  await backend.stop();
  client.receiver.emit("status", finished);
  assert.equal(statuses.filter((status) => status.finished).length, 1);
  await backend.close();
  assert.equal(client.closed, true);
});

test("Cast disconnect rejects pending operations and reports failure once", async () => {
  const client = new FakeClient();
  const errors: string[] = [];
  const backend = await connectCastBackend(
    client as unknown as Client,
    { id: "chromecast:1", name: "Cast", protocol: "chromecast", address: "127.0.0.1" },
    () => {},
    (message) => errors.push(message),
  );
  let started!: () => void;
  const held = new Promise<void>((resolve) => {
    started = resolve;
  });
  client.receiver.load = () => {
    started();
  };
  const load = backend.load("http://127.0.0.1/token", track, 0, true);
  await held;
  client.client.emit("close");
  await assert.rejects(load, /closed/);
  assert.deepEqual(errors, ["Chromecast disconnected"]);
  await backend.close();
});

test("UPnP pending URI or seek cannot play after stop, pause, or a newer load", async (t) => {
  for (const heldAction of ["SetAVTransportURI", "Seek"]) {
    for (const interrupt of ["stop", "pause", "load"] as const) {
      await t.test(`${heldAction} interrupted by ${interrupt}`, async () => {
        const actions: string[] = [];
        const events = new EventEmitter();
        let deviceState = "STOPPED";
        let activeSuffix = "";
        let held!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
          held = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let heldOnce = false;
        const server = createServer(async (req, res) => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString();
          const action = String(req.headers.soapaction).split("#")[1]?.replace(/"/g, "") ?? "";
          const label =
            action === "SetAVTransportURI"
              ? `${action}:${body.includes("/old") ? "old" : "new"}`
              : action;
          actions.push(label);
          if (!heldOnce && action === heldAction) {
            heldOnce = true;
            held();
            await gate;
          }
          if (action === "SetAVTransportURI") activeSuffix = body.includes("/old") ? "old" : "new";
          if (action === "Play") deviceState = "PLAYING";
          if (action === "Pause") deviceState = "PAUSED_PLAYBACK";
          if (action === "Stop") deviceState = "STOPPED";
          const response =
            action === "GetPositionInfo"
              ? `<RelTime>${deviceState === "PLAYING" ? "00:00:09" : "00:00:00"}</RelTime><TrackDuration>00:00:10</TrackDuration><TrackURI>${base}/${activeSuffix}</TrackURI>`
              : `<CurrentTransportState>${deviceState}</CurrentTransportState>`;
          res.end(
            `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:test">${response}</u:${action}Response></s:Body></s:Envelope>`,
          );
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const backend = await createUpnpBackend(
          { id: "upnp:1", protocol: "upnp", name: "Mock", controlUrl: base },
          (status) => events.emit("status", status),
          (error) => assert.fail(error),
        );
        try {
          const oldLoad = backend.load(`${base}/old`, track, 3000, true);
          await started;
          const next =
            interrupt === "load"
              ? backend.load(`${base}/new`, track, 0, true)
              : backend[interrupt]();
          release();
          await Promise.all([oldLoad, next]);
          assert.deepEqual(
            actions.filter((action) => action === "Play"),
            interrupt === "load" ? ["Play"] : [],
          );
          if (interrupt === "load")
            assert(actions.indexOf("SetAVTransportURI:new") < actions.indexOf("Play"));
          else assert.equal(actions.at(-1), interrupt === "stop" ? "Stop" : "Pause");
          if (interrupt === "pause") {
            await backend.play();
            const [playing] = await once(events, "status", { signal: AbortSignal.timeout(2500) });
            assert.equal(playing.state, "playing");
            assert.equal(playing.positionMs, 9000);
            deviceState = "STOPPED";
            const [ended] = await once(events, "status", { signal: AbortSignal.timeout(2500) });
            assert.equal(ended.finished, true);
          }
        } finally {
          release();
          await backend.close();
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      });
    }
  }
});

test("Cast pending LOAD stays paused after stop or pause and serializes newer media", async (t) => {
  for (const interrupt of ["stop", "pause", "load"] as const) {
    await t.test(interrupt, async () => {
      const client = new FakeClient();
      const operations: string[] = [];
      const statuses: OutputPlaybackStatus[] = [];
      let started!: () => void;
      let complete!: () => void;
      const held = new Promise<void>((resolve) => {
        started = resolve;
      });
      const originalLoad = client.receiver.load.bind(client.receiver);
      const originalPlay = client.receiver.play.bind(client.receiver);
      let first = true;
      client.receiver.play = (done) => {
        operations.push("play");
        originalPlay(done);
      };
      client.receiver.load = (media, options, done) => {
        operations.push(String(media.contentId));
        assert.equal(options.autoplay, false);
        if (!first) {
          originalLoad(media, options, done);
          return;
        }
        first = false;
        complete = () => originalLoad(media, options, done);
        started();
      };
      const backend = await connectCastBackend(
        client as unknown as Client,
        { id: "chromecast:1", protocol: "chromecast", name: "Mock", address: "127.0.0.1" },
        (status) => statuses.push(status),
        (message) => assert.fail(message),
      );
      try {
        const oldLoad = backend.load("http://127.0.0.1/old", track, 0, true);
        await held;
        const next =
          interrupt === "load"
            ? backend.load("http://127.0.0.1/new", track, 0, true)
            : backend[interrupt]();
        assert.deepEqual(operations, ["http://127.0.0.1/old"]);
        complete();
        await Promise.all([oldLoad, next]);
        assert.deepEqual(
          operations,
          interrupt === "load"
            ? ["http://127.0.0.1/old", "http://127.0.0.1/new", "play"]
            : ["http://127.0.0.1/old"],
        );
        if (interrupt === "pause") {
          assert.equal(statuses.at(-1)?.state, "paused");
          await backend.play();
          assert.equal(statuses.at(-1)?.state, "playing");
          client.receiver.emit("status", {
            mediaSessionId: 1,
            playerState: "PLAYING",
            currentTime: 9,
            media: { contentId: "http://127.0.0.1/old", duration: 10 },
          });
          assert.equal(statuses.at(-1)?.positionMs, 9000);
          client.receiver.emit("status", {
            mediaSessionId: 1,
            playerState: "IDLE",
            idleReason: "FINISHED",
          });
          assert.equal(statuses.at(-1)?.finished, true);
          assert.equal(statuses.filter((status) => status.finished).length, 1);
        }
      } finally {
        await backend.close();
      }
    });
  }
});

test("Sonos resolves sanitized real wrapped topology for standalone, groups, and home theater satellites", () => {
  const standalone = `<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator="RINCON_EXAMPLE" ID="RINCON_EXAMPLE:686274794"><ZoneGroupMember UUID="RINCON_EXAMPLE" Location="http://192.0.2.16:1400/xml/device_description.xml" ZoneName="示例房间" Configuration="1" SoftwareVersion="98.0-82170" SWGen="2" BootSeq="5" /></ZoneGroup></ZoneGroups><VanishedDevices /></ZoneGroupState>`;
  assert.equal(
    resolveSonosCoordinator(standalone, "sonos:RINCON_EXAMPLE"),
    "http://192.0.2.16:1400/xml/device_description.xml",
  );
  const grouped = `<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator="RINCON_OTHER" ID="other"><ZoneGroupMember UUID="RINCON_OTHER" Location="http://192.0.2.20:1400/xml/device_description.xml" /></ZoneGroup><ZoneGroup Coordinator="RINCON_COORD" ID="group"><ZoneGroupMember UUID="RINCON_COORD" Location="http://192.0.2.30:1400/xml/device_description.xml"><Satellite UUID="RINCON_REAR" Location="http://192.0.2.31:1400/xml/device_description.xml" Invisible="1" /></ZoneGroupMember><ZoneGroupMember UUID="RINCON_MEMBER" Location="http://192.0.2.32:1400/xml/device_description.xml" /></ZoneGroup></ZoneGroups><VanishedDevices><Device UUID="RINCON_GONE" /></VanishedDevices></ZoneGroupState>`;
  assert.equal(
    resolveSonosCoordinator(grouped, "sonos:RINCON_MEMBER"),
    "http://192.0.2.30:1400/xml/device_description.xml",
  );
  assert.equal(
    resolveSonosCoordinator(grouped, "sonos:RINCON_REAR"),
    "http://192.0.2.30:1400/xml/device_description.xml",
  );
  assert.equal(
    resolveSonosCoordinator(grouped.replace(/<\/?ZoneGroupState>/g, ""), "sonos:RINCON_REAR"),
    "http://192.0.2.30:1400/xml/device_description.xml",
  );
  assert.throws(
    () => resolveSonosCoordinator(grouped, "sonos:RINCON_GONE"),
    /无法找到 Sonos 当前分组的主设备/,
  );
});
