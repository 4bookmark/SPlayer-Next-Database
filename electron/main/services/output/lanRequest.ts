import { Agent, fetch as directFetch } from "undici";

// 未配置代理时复用直连池，用户明确设置代理时沿用其网络路径
const dispatcher = new Agent({ connections: 4, pipelining: 1 });
let directSession: Promise<import("electron").Session> | undefined;

/**
 * 请求局域网播放设备，保留用户网络设置、取消信号和请求参数
 * @param url - 已发现设备的服务地址
 * @param init - HTTP 请求参数
 * @returns 设备 HTTP 响应
 */
export const fetchLan = async (url: string, init?: RequestInit): Promise<Response> => {
  if (process.versions.electron) {
    const { getNetworkProxyUrl, fetchWithProxy } = await import("@main/utils/proxy");
    if (getNetworkProxyUrl()) return fetchWithProxy(url, { ...init, redirect: "error" });
    directSession ??= import("electron").then(async ({ session }) => {
      const output = session.fromPartition("output-lan-direct");
      await output.setProxy({ mode: "direct" });
      return output;
    });
    return (await directSession).fetch(url, { ...init, redirect: "error" });
  }
  return directFetch(url, {
    ...init,
    dispatcher,
    redirect: "error",
  } as Parameters<typeof directFetch>[1]) as unknown as Promise<Response>;
};
