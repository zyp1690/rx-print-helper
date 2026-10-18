/* 在真实 Chromium 中截图，验证四个新功能的视觉效果 */
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");
const http = require("http");
const url = require("url");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8" };
const root = __dirname;
let server, PORT;

function startServer() {
  return new Promise(res => {
    server = http.createServer((req, rq) => {
      let p = decodeURIComponent(url.parse(req.url).pathname);
      if (p === "/" || p === "") p = "/处方打印助手.html";
      const f = path.join(root, p);
      fs.readFile(f, (e, b) => {
        if (e) { rq.writeHead(404); rq.end("NF"); return; }
        rq.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
        rq.end(b);
      });
    });
    server.listen(0, "127.0.0.1", () => { PORT = server.address().port; res(); });
  });
}

const OUT = path.join(root, "shots");
fs.mkdirSync(OUT, { recursive: true });

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + ".png"), img.toPNG());
  console.log("  截图 " + name + ".png");
}

app.whenReady().then(async () => {
  await startServer();
  const win = new BrowserWindow({
    width: 1500, height: 940, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  await win.loadURL("http://127.0.0.1:" + PORT + "/处方打印助手.html");
  await new Promise(r => setTimeout(r, 2200));

  const js = c => win.webContents.executeJavaScript(c, true);

  // 填入示例数据
  await js("loadSample()");
  await new Promise(r => setTimeout(r, 700));
  await shot(win, "1-默认横向单张");

  // 竖向
  await js("setOrient('portrait')");
  await new Promise(r => setTimeout(r, 600));
  await shot(win, "2-竖向");

  // A4 两张
  await js("setOrient('landscape'); setMultiUp(2)");
  await new Promise(r => setTimeout(r, 700));
  await shot(win, "3-A4两张-横向");

  // 竖向 + 两张（旋转排版）
  await js("setOrient('portrait'); setMultiUp(2)");
  await new Promise(r => setTimeout(r, 700));
  await shot(win, "4-A4两张-竖向旋转");

  // 导入弹窗 + 手动匹配
  await js("setOrient('landscape'); setMultiUp(1); openImport()");
  await new Promise(r => setTimeout(r, 400));
  await js(`
    impHeader=['列甲','列乙','列丙','列丁','列戊'];
    impRows=[{列甲:'阿莫西林胶囊',列乙:'0.25g*24粒',列丙:'山东制药',列丁:'12.50',列戊:'口服'}];
    impAutoMap={}; impFieldOn={}; impManual={};
    renderImportFields();
    document.getElementById('impFieldsStep').style.display='block';
    document.getElementById('impModeStep').style.display='block';
    document.getElementById('impConfirm').disabled=false;
  `);
  await new Promise(r => setTimeout(r, 400));
  await shot(win, "5-自动匹配最终");

  await js("toggleManualMap(true)");
  await new Promise(r => setTimeout(r, 700));
  await js("setManualCol('s','列乙'); setManualCol('m','列丙'); setManualCol('du','列戊')");
  await new Promise(r => setTimeout(r, 900));
  await shot(win, "6-手动匹配最终");

  console.log("全部截图完成");
  app.quit();
});