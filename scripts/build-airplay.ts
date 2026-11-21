import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 使用 Command Line Tools 构建原生 AirPlay 辅助程序
 * @param arch - 与 Electron 打包架构一致的目标架构
 * @returns 辅助程序的绝对路径，非 macOS 返回 undefined
 */
export function buildAirplay(arch: string = process.arch): string | undefined {
  if (process.platform !== "darwin") return undefined;
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`Unsupported AirPlay helper architecture: ${arch}`);
  }
  const directory = fileURLToPath(new URL("../native/airplay-helper/", import.meta.url));
  mkdirSync(directory, { recursive: true });
  const output = path.join(directory, "airplay-helper");
  const target = `${arch === "x64" ? "x86_64" : "arm64"}-apple-macosx11.0`;
  const result = spawnSync(
    "xcrun",
    [
      "swiftc",
      "-swift-version",
      "5",
      "-O",
      "-target",
      target,
      "-framework",
      "AppKit",
      "-framework",
      "AVKit",
      "-framework",
      "AVFoundation",
      path.join(directory, "main.swift"),
      "-o",
      output,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`AirPlay helper build failed (${result.status})`);
  chmodSync(output, 0o755);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildAirplay(process.env.npm_config_arch || process.arch);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
