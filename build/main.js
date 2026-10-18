/* ============================================================
 * 处方打印助手 — Electron 主进程
 * 作者：火舞狂沙
 * 目标平台：Windows 7 及以上（Electron 22 / Chromium 108）
 * ============================================================ */
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const url = require("url");

const APP_NAME = "处方打印助手";
const AUTHOR = "火舞狂沙";
const VERSION = app.getVersion();

/* ---------- 单实例：再次运行则聚焦已有窗口 ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

/* ---------- 内嵌静态服务：让页面跑在 http:// 下 ----------
 * 这样 localStorage、剪贴板、xlsx 解析等API 不会被 file:// 限制 */
let localServer = null;
let localURL = "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const root = app.getAppPath();
    localServer = http.createServer((req, res) => {
      let p = decodeURIComponent(url.parse(req.url).pathname);
      if (p === "/" || p === "") p = "/处方打印助手.html";
      const safe = path.normalize(p).replace(/^(\.\.[\/\\])+/, "");
      const file = path.join(root, safe);
      /* 防目录穿越 */
      if (!file.startsWith(root)) { res.writeHead(403); res.end("Forbidden"); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end("Not Found"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
        res.end(buf);
      });
    });
    localServer.on("error", reject);
    localServer.listen(port, "127.0.0.1", () => {
      localURL = "http://127.0.0.1:" + localServer.address().port + "/处方打印助手.html";
      resolve(localURL);
    });
  });
}

/* ---------- 主窗口 ---------- */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: "#eef2f6",
    icon: path.join(__dirname, "res", "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
      spellcheck: false
    }
  });

  mainWindow.loadURL(localURL);

  /* 打印走系统打印对话框 */
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.setTitle(APP_NAME + "  —  © " + AUTHOR);
  });

  /* 外部链接交给系统浏览器 */
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/i.test(u)) shell.openExternal(u);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

/* ---------- 菜单 ---------- */
/* ---------- 打印 ---------- */
/* mm → 微英寸（Electron 打印 API 用 device units，1 inch = 1000） */
function mm2du(mm) { return Math.round(mm / 25.4 * 1000); }

/** 读取页面当前的纸张设置（方向 + 拼版张数） */
async function readPaperSetup() {
  try {
    const js = `(function(){
      var m = multiPerSheet();
      var p = rxPaper();
      return JSON.stringify({
        multi: m,
        orient: (typeof state!=='undefined' && state.paper) ? state.paper.orient : "landscape",
        w: p.w, h: p.h
      });
    })()`;
    return JSON.parse(await mainWindow.webContents.executeJavaScript(js, true));
  } catch (e) {
    return { multi: 1, orient: "landscape", w: 210, h: 148 };
  }
}

/** 统一的打印动作：按当前纸张方向显式指定打印尺寸
 *  关键：Electron 的 webContents.print() 默认用 Letter，且不理会 CSS 的 @page，
 *  必须通过 pageSize 显式传 A4 横向/纵向，否则横竖向切换对打印无效。 */
async function doPrint() {
  const setup = await readPaperSetup();
  const isPortrait = setup.orient === "portrait";
  /* 拼版时A4 跟随纸张方向（4 张会自动切横向 → A4 landscape）
   * 单张时也按处方纸方向输出 A4 对应方向 */
  const usePortrait = isPortrait;
  const pw = usePortrait ? 210 : 297;
  const ph = usePortrait ? 297 : 210;

  mainWindow.webContents.print(
    {
      silent: false,
      printBackground: true,
      pageSize: { width: mm2du(pw), height: mm2du(ph) },
      margins: { marginType: "none" },
      landscape: !usePortrait
    },
    (success, reason) => {
      if (!success && reason && reason !== "cancelled") {
        dialog.showErrorBox("打印失败", "无法完成打印：" + reason);
      }
    }
  );
}

function buildMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        {
          label: "打印处方",
          accelerator: "CmdOrCtrl+P",
          click: () => doPrint()
        },
        { type: "separator" },
        { role: "quit", label: "退出" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
        ...(process.argv.includes("--dev") ? [{ role: "toggleDevTools", label: "开发者工具" }] : [])
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于 " + APP_NAME,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "关于 " + APP_NAME,
              message: APP_NAME,
              detail:
                "版本：" + VERSION + "\n" +
                "作者：" + AUTHOR + "\n" +
                "版权所有 © " + new Date().getFullYear() + " " + AUTHOR + "\n\n" +
                "面向药店与基层医疗机构的处方录入、识别与打印工具。\n" +
                "数据全部保存在本机，不上传任何服务器，断网可用。",
              buttons: ["确定"]
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- 启动 ---------- */
app.whenReady().then(async () => {
  try {
    await startServer(0);
  } catch (e) {
    dialog.showErrorBox("启动失败", "无法启动本地服务：" + e.message);
    app.quit();
    return;
  }

  /* 页面里的「打印」按钮通过 IPC 请求打印，以便按当前纸张方向指定尺寸 */
  ipcMain.handle("print-request", async () => {
    if (!mainWindow) return false;
    await doPrint();
    return true;
  });

  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (localServer) { try { localServer.close(); } catch (e) {} }
  if (process.platform !== "darwin") app.quit();
});