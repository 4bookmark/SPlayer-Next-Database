import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 构建使用系统 Bonjour 与局域网权限的辅助进程
 * @param arch - 与 Electron 一致的目标架构
 * @returns 可执行程序路径
 */
export function buildLanDiscovery(arch: string = process.arch): string | undefined {
  if (process.platform !== "darwin") return undefined;
  if (arch !== "arm64" && arch !== "x64") throw new Error("不支持的局域网辅助程序架构");
  const directory = fileURLToPath(new URL("../native/lan-discovery/", import.meta.url));
  const output = path.join(directory, "lan-discovery");
  const result = spawnSync(
    "xcrun",
    [
      "swiftc",
      "-swift-version",
      "5",
      "-O",
      "-target",
      `${arch === "x64" ? "x86_64" : "arm64"}-apple-macosx11.0`,
      path.join(directory, "main.swift"),
      "-o",
      output,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("局域网辅助程序构建失败");
  chmodSync(output, 0o755);
  return output;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildLanDiscovery(process.env.npm_config_arch || process.arch);
}
