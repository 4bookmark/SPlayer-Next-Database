import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isIPv4 } from "node:net";
import type { OutputTarget } from "@shared/types/output";
const execute = promisify(execFile);
type MacOutputTarget = OutputTarget & { location?: string };

/**
 * 使用系统 Bonjour 发现设备并触发所属应用的本地网络授权
 * @returns 有界设备列表与系统错误
 */
export const scanMacOutputs = async (): Promise<{ targets: MacOutputTarget[]; error?: string }> => {
  const { app } = await import("electron");
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, "lan-discovery")
    : path.join(app.getAppPath(), "native", "lan-discovery", "lan-discovery");
  const { stdout } = await execute(executable, [], { timeout: 8000, maxBuffer: 64 * 1024 });
  const result = JSON.parse(stdout) as { targets?: MacOutputTarget[]; error?: string };
  if (!Array.isArray(result.targets) || result.targets.length > 64)
    throw new Error("Bonjour 返回的设备清单无效");
  return {
    targets: result.targets.filter(
      (target) =>
        target &&
        (target.protocol === "chromecast" || target.protocol === "sonos") &&
        typeof target.id === "string" &&
        target.id.length <= 128 &&
        typeof target.name === "string" &&
        target.name.length <= 256 &&
        typeof target.address === "string" &&
        isIPv4(target.address) &&
        Number.isInteger(target.port) &&
        target.port! > 0 &&
        target.port! <= 65535,
    ),
    error: typeof result.error === "string" ? result.error : undefined,
  };
};
