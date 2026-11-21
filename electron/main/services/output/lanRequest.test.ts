import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { readDeviceXml } from "./upnp";

test("UPnP 描述与 SOAP 直连，不受全局代理影响且保留请求参数", async (t) => {
  const requests: { method?: string; action?: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, action: req.headers.soapaction as string, body });
    res.setHeader("Content-Type", "text/xml");
    res.end("<root><device><friendlyName>Living Room</friendlyName></device></root>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const previous = getGlobalDispatcher();
  const blocked = new Agent({
    connect: (_options, callback) => callback(new Error("Proxy cannot reach LAN"), null),
  });
  setGlobalDispatcher(blocked);
  t.after(async () => {
    setGlobalDispatcher(previous);
    await blocked.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const result = await readDeviceXml(
    `http://127.0.0.1:${port}/description`,
    AbortSignal.timeout(3000),
    { method: "POST", headers: { SOAPACTION: "GetTransportInfo" }, body: "action" },
  );
  assert.equal(result.root.device.friendlyName, "Living Room");
  assert.deepEqual(requests, [{ method: "POST", action: "GetTransportInfo", body: "action" }]);
  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(readDeviceXml(`http://127.0.0.1:${port}`, cancel.signal));
});
