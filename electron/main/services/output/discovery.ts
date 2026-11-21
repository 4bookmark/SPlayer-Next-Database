import dgram from "node:dgram";
import { networkInterfaces } from "node:os";
import { Bonjour } from "bonjour-service";
import type { OutputTarget } from "@shared/types/output";
import { readDeviceXml } from "./upnp";
import { scanMacOutputs } from "./macDiscovery";

/** 将设备描述转换为播放目标，包含 Sonos 嵌套 MediaRenderer
 * @param location - SSDP 描述地址
 * @param signal - 扫描取消信号
 * @returns 可播放目标
 */
export async function describeRenderer(
  location: string,
  signal: AbortSignal,
): Promise<OutputTarget[]> {
  const xml = await readDeviceXml(location, signal);
  const targets: OutputTarget[] = [];
  /** 遍历嵌套设备及其服务
   * @param device - 描述中的设备
   * @param parent - 父设备身份
   */
  function visit(device: any, parent?: any): void {
    if (!device) return;
    const sonosDevice =
      /sonos/i.test(String(device.manufacturer ?? parent?.manufacturer ?? "")) ||
      /ZonePlayer/.test(String(parent?.deviceType ?? device.deviceType));
    const identity = sonosDevice && parent?.UDN ? parent : device.UDN ? device : (parent ?? device);
    const list = device.serviceList?.service ?? [];
    const services = Array.isArray(list) ? list : [list];
    const av = services.find((service: any) =>
      /^urn:schemas-upnp-org:service:AVTransport:\d+$/.test(service.serviceType),
    );
    const rendering = services.find((service: any) =>
      /^urn:schemas-upnp-org:service:RenderingControl:\d+$/.test(service.serviceType),
    );
    if (av?.controlURL && identity.UDN) {
      const protocol = sonosDevice ? "sonos" : "upnp";
      const base = xml.root?.URLBase || location;
      targets.push({
        id: `${protocol}:${String(identity.UDN).replace(/^uuid:/, "")}`,
        name:
          (sonosDevice ? identity.roomName : undefined) ||
          (sonosDevice ? parent?.friendlyName : undefined) ||
          device.friendlyName ||
          parent?.friendlyName ||
          new URL(location).hostname,
        protocol,
        address: new URL(location).hostname,
        port: Number(new URL(location).port) || 80,
        controlUrl: new URL(av.controlURL, base).href,
        renderingUrl: rendering?.controlURL ? new URL(rendering.controlURL, base).href : undefined,
      });
    }
    const children = device.deviceList?.device ?? [];
    for (const child of Array.isArray(children) ? children : [children]) visit(child, device);
  }
  visit(xml.root?.device);
  return targets;
}

/** 扫描局域网设备，macOS 使用系统 Bonjour 处理应用授权
 * @param report - 有界扫描诊断，不包含媒体或账号信息
 * @returns 按稳定设备标识去重后的播放目标
 */
export async function scanOutputTargets(
  report?: (message: string) => void,
): Promise<OutputTarget[]> {
  const targets = new Map<string, OutputTarget>();
  const locations = new Set<string>();
  const interfaces = Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && !iface.internal && iface.family === "IPv4");
  const localAddresses = new Set(interfaces.map((iface) => iface!.address));
  const controller = new AbortController();
  const sockets: dgram.Socket[] = [];
  const pending: Promise<void>[] = [];
  let finished = false;
  let packets = 0;
  let failure: string | undefined;
  /** 保留首个底层错误，避免大量重复响应刷屏
   * @param error - 网络或授权失败
   */
  const failed = (error: unknown): void => {
    if (failure) return;
    failure = error instanceof Error ? error.message : String(error);
    report?.(`设备扫描错误: ${failure.slice(0, 160)}`);
  };
  const native =
    process.platform === "darwin"
      ? scanMacOutputs()
          .then(async (result) => {
            report?.(
              `原生发现: Chromecast=${result.targets.filter((target) => target.protocol === "chromecast").length}, Sonos=${result.targets.filter((target) => target.protocol === "sonos").length}`,
            );
            await Promise.all(
              result.targets.map(async (target) => {
                if (target.protocol !== "sonos") {
                  targets.set(target.id, target);
                  return;
                }
                const location = new URL(
                  target.location ?? `http://${target.address}:1400/xml/device_description.xml`,
                );
                if (
                  location.protocol !== "http:" ||
                  location.hostname !== target.address ||
                  location.username ||
                  location.password
                )
                  return;
                try {
                  const devices = await describeRenderer(
                    location.href,
                    AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]),
                  );
                  for (const device of devices) targets.set(device.id, device);
                } catch (error) {
                  report?.(
                    `Sonos描述读取失败: ${error instanceof Error ? error.message : String(error)}`,
                  );
                  failed(error);
                }
              }),
            );
            if (result.error) failed(result.error);
          })
          .catch(failed)
      : Promise.resolve();
  const bonjour = process.platform === "darwin" ? undefined : new Bonjour(undefined, failed);
  const browser = bonjour?.find({ type: "googlecast" }, (service) => {
    if (finished) return;
    const address = service.addresses?.find(
      (entry) => !entry.includes(":") && !localAddresses.has(entry),
    );
    const uuid = service.txt?.id?.toString();
    if (!address || !uuid) return;
    targets.set(`chromecast:${uuid}`, {
      id: `chromecast:${uuid}`,
      name: service.txt?.fn?.toString() || service.name,
      protocol: "chromecast",
      address,
      port: service.port,
    });
  });
  try {
    for (const iface of interfaces) {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      sockets.push(socket);
      socket.on("error", failed);
      socket.on("message", (packet) => {
        if (finished) return;
        packets++;
        const location = packet
          .toString()
          .match(/^location:\s*(.+)$/im)?.[1]
          ?.trim();
        if (!location || locations.has(location) || locations.size >= 128) return;
        let url: URL;
        try {
          url = new URL(location);
        } catch {
          return;
        }
        if (
          url.protocol !== "http:" ||
          url.username ||
          url.password ||
          localAddresses.has(url.hostname)
        )
          return;
        locations.add(location);
        pending.push(
          describeRenderer(location, controller.signal)
            .then((devices) => {
              if (!finished) for (const device of devices) targets.set(device.id, device);
            })
            .catch(failed),
        );
      });
      socket.bind(0, iface!.address, () => {
        if (finished) return;
        try {
          socket.setMulticastInterface(iface!.address);
        } catch (error) {
          failed(error);
          return;
        }
        for (const type of [
          "urn:schemas-upnp-org:device:MediaRenderer:1",
          "urn:schemas-upnp-org:device:ZonePlayer:1",
          "ssdp:all",
        ]) {
          const request = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${type}\r\n\r\n`;
          socket.send(request, 1900, "239.255.255.250", (error) => {
            if (error) failed(error);
          });
        }
      });
    }
    await Promise.all([new Promise<void>((resolve) => setTimeout(resolve, 4800)), native]);
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => setTimeout(resolve, 1000)),
    ]);
  } finally {
    finished = true;
    controller.abort();
    browser?.stop();
    bonjour?.destroy();
    for (const socket of sockets) {
      try {
        socket.close();
      } catch {
        /* 绑定失败的套接字可能已关闭 */
      }
    }
  }
  report?.(
    `设备扫描完成: 网卡=${interfaces.length}, SSDP响应=${packets}, 描述=${locations.size}, 设备=${targets.size}`,
  );
  if (!targets.size && failure) {
    throw new Error(
      process.platform === "darwin"
        ? "局域网设备发现受限，请在系统设置 → 隐私与安全性 → 本地网络中允许 SPlayer-Next，然后重新扫描"
        : "局域网设备扫描失败，请检查网络连接后重试",
    );
  }
  return [...targets.values()].sort((a, b) => a.name.localeCompare(b.name));
}
