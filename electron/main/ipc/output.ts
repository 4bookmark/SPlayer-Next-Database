import { ipcMain } from "electron";
import { getPlayer } from "@main/services/engine";
import { getOutputState, scanOutputs, selectOutput } from "@main/services/output/controller";

/** 注册统一播放设备控制，网络协议仅在用户操作时启动 */
export const registerOutputIpc = (): void => {
  ipcMain.handle("output:getState", getOutputState);
  ipcMain.handle("output:scan", scanOutputs);
  ipcMain.handle("output:select", (_event, id: string) => {
    if (typeof id !== "string") throw new Error("播放设备标识无效");
    getPlayer();
    return selectOutput(id);
  });
};
