// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  setProxy: vi.fn(),
  fetch: vi.fn(),
  partition: vi.fn(),
  proxyUrl: undefined as string | undefined,
  proxyFetch: vi.fn(),
}));
vi.mock("electron", () => ({ session: { fromPartition: state.partition } }));
vi.mock("@main/utils/proxy", () => ({
  getNetworkProxyUrl: () => state.proxyUrl,
  fetchWithProxy: state.proxyFetch,
}));
beforeEach(() => {
  state.proxyUrl = undefined;
  vi.resetModules();
  Object.defineProperty(process.versions, "electron", { value: "test", configurable: true });
  state.partition.mockReturnValue({ setProxy: state.setProxy, fetch: state.fetch });
  state.setProxy.mockResolvedValue(undefined);
  state.fetch.mockResolvedValue(new Response("device"));
});
afterEach(() => {
  delete (process.versions as Record<string, string | undefined>).electron;
});
it("安装版复用独立直连会话，设备请求不会进入公网代理且保留取消信号", async () => {
  const { fetchLan } = await import("./lanRequest");
  const signal = new AbortController().signal;
  await fetchLan("http://192.0.2.16:1400/xml/device_description.xml", { signal });
  await fetchLan("http://192.0.2.16:1400/control", { method: "POST", body: "soap", signal });
  expect(state.partition).toHaveBeenCalledOnce();
  expect(state.setProxy).toHaveBeenCalledExactlyOnceWith({ mode: "direct" });
  expect(state.fetch).toHaveBeenLastCalledWith("http://192.0.2.16:1400/control", {
    method: "POST",
    body: "soap",
    signal,
    redirect: "error",
  });
});

it("显式配置代理时遵循用户网络路径，保留 SOAP 请求参数", async () => {
  state.proxyUrl = "socks5://127.0.0.1:7890";
  const { fetchLan } = await import("./lanRequest");
  const signal = new AbortController().signal;
  await fetchLan("http://192.0.2.16:1400/control", { method: "POST", body: "soap", signal });
  expect(state.proxyFetch).toHaveBeenCalledWith("http://192.0.2.16:1400/control", {
    method: "POST",
    body: "soap",
    signal,
    redirect: "error",
  });
  expect(state.partition).not.toHaveBeenCalled();
});
