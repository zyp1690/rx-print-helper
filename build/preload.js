/* preload：向页面暴露最小必要的 IPC 接口
 * 页面无法直接调用 Electron API（contextIsolation: true），打印需经此桥接。 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  /* 是否运行在桌面版（exe）中 */
  isDesktop: true,
  /* 请求打印：主进程会按当前纸张方向传入正确的 A4 横向/纵向 */
  print: () => ipcRenderer.invoke("print-request")
});