/* 功能自测：在真实 DOM 中验证四个新功能
 * 用法：node test-features.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "处方打印助手.html"), "utf8")
  /* 去掉外部 js 引用，测试不需要药品库 */
  .replace(/<script src="药品清单库\.js"><\/script>/, "");

const errors = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "http://127.0.0.1/",
  beforeParse(win) {
    /* 屏蔽会弹窗的 confirm/alert */
    win.confirm = () => true;
    win.alert = () => {};
    win.matchMedia = win.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    win.addEventListener("error", e => errors.push("window error: " + (e.error && e.error.message)));
  }
});

const { window } = dom;
const doc = window.document;
const $ = id => doc.getElementById(id);
let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (detail ? "  → " + detail : "")); }
}

setTimeout(() => {
  /* 脚本里 let/const 声明不会挂到 window，需从作用域内取值 */
  const st = window.eval("state");
  const fn = src => window.eval(src);
  /* state 会被整体重建，因此每次都重新求值 */
  const w = () => window.eval("state");
  const multiUp = fn("multiPerSheet()");
  const setOrient = fn("setOrient");
  const setMultiUp = fn("setMultiUp");
  const newRxTest = () => fn("newPrescription")();
  const nextRxTest = () => window.eval("nextRx()");
  const goRx = fn("goRx");
  const rxCount = fn("rxCount");
  const renderImportFields = fn("renderImportFields");
  const toggleManualMap = fn("toggleManualMap");
  const setManualCol = fn("setManualCol");
  const clearManualMap = fn("clearManualMap");
  const autoFillUnmatched = fn("autoFillUnmatched");
  const openImport = fn("openImport");
  const loadSample = fn("loadSample");
  const mapRow = fn("mapRow");

  console.log("\n=== 1. 纸张方向 / 内容方向 分离 ===");
  const a4 = () => fn("a4Sheet()");
  const rxp = () => fn("rxPaper()");
  ok("默认 A4 横向 297×210", a4().w === 297 && a4().h === 210, JSON.stringify(a4()));
  ok("默认内容横向 210×148", rxp().w === 210 && rxp().h === 148, JSON.stringify(rxp()));

  /* 内容方向：独立于纸张方向 */
  window.eval("setRxOrient('portrait')");
  ok("内容切竖向 → 148×210", rxp().w === 148 && rxp().h === 210, JSON.stringify(rxp()));
  ok("内容切竖向不影响 A4 纸张", a4().w === 297 && a4().h === 210);
  ok("#page 宽度跟随内容方向", $("page").style.width === "148mm", $("page").style.width);
  ok("内容方向按钮高亮",
     doc.querySelector('#rxOrientSeg .seg-btn[data-rxorient="portrait"]').classList.contains("on"));
  window.eval("setRxOrient('landscape')");
  ok("内容切回横向 210×148", rxp().w === 210 && rxp().h === 148);

  /* A4 纸张方向：独立于内容方向 */
  window.eval("setOrient('portrait')");
  ok("A4 切纵向 → 210×297", a4().w === 210 && a4().h === 297, JSON.stringify(a4()));
  ok("A4 切纵向不影响内容方向", rxp().w === 210 && rxp().h === 148);
  window.eval("setOrient('landscape')");
  ok("A4 切回横向 297×210", a4().w === 297 && a4().h === 210);

  console.log("\n=== 2. 一张 A4 打印处方数量（三种组合） ===");
  ok("默认每张 1 张", w().paper.multi === 1 && multiUp === 1);
  setMultiUp(2);
  ok("切到每张 2 张", w().paper.multi === 2 && fn("multiPerSheet()") === 2);
  ok("body 标记 multi-up", doc.body.classList.contains("multi-up"));
  const cells = doc.querySelectorAll("#sheet .sheet-cell");
  ok("生成 2 个格子", cells.length === 2, "实际 " + cells.length);
  ok("外层为 A4 宽 297mm", $("sheet").style.width === "297mm", $("sheet").style.width);
  ok("#page 已挂入格子里", cells[0] && cells[0].contains($("page")));
  ok("标签显示 2 张联排", /2 张联排/.test($("pvSize").textContent), $("pvSize").textContent);
  ok("2 张按钮高亮", doc.querySelector('#multiSeg .seg-btn[data-multi="2"]').classList.contains("on"));

  /* ---- 2 张 = 纸张横 + 内容竖 ---- */
  ok("2 张 → A4 横向", w().paper.orient === "landscape", w().paper.orient);
  ok("2 张 → 内容竖向", w().paper.rxOrient === "portrait", w().paper.rxOrient);
  ok("2 张内容尺寸 148×210", rxp().w === 148 && rxp().h === 210);
  const rotP2 = [...doc.querySelectorAll("#sheet .rx-page")].filter(p => p.classList.contains("rot"));
  ok("2 张不旋转（内容正向）", rotP2.length === 0, rotP2.length + " 个旋转");
  const g2 = fn("calcGrid({w:148,h:210},2,297,210)");
  ok("2 张为 2列×1行并排", g2.cols === 2 && g2.rows === 1 && g2.rotated === false,
     JSON.stringify({c: g2.cols, r: g2.rows, rot: g2.rotated}));
  ok("2 张为原尺寸无缩放（scale=1）", Math.abs(g2.scale - 1) < 0.001, "scale=" + g2.scale);

  /* ---- 4 张 = 纸张横 + 内容横 ---- */
  setMultiUp(4);
  ok("4 张 → A4 横向", w().paper.orient === "landscape", w().paper.orient);
  ok("4 张 → 内容横向", w().paper.rxOrient === "landscape", w().paper.rxOrient);
  ok("4 张时 A4 为 297×210", a4().w === 297 && a4().h === 210);
  const cells4 = doc.querySelectorAll("#sheet .sheet-cell");
  ok("4 张 → 生成 4 个格子", w().paper.multi === 4 && cells4.length === 4, "实际 " + cells4.length);
  ok("4 张格子宽=148.5mm(297/2)", cells4[0] && cells4[0].style.width === "148.5mm",
     cells4[0] && cells4[0].style.width);
  const g4 = fn("calcGrid({w:210,h:148},4,297,210)");
  ok("4 张为 2×2 排布", g4.cols === 2 && g4.rows === 2 && g4.rotated === false,
     JSON.stringify({c: g4.cols, r: g4.rows, rot: g4.rotated}));
  ok("4 张缩小约 70.7%", /0\.707/.test(String(g4.scale.toFixed(3))), "scale=" + g4.scale.toFixed(3));
  ok("4 张节点标记 data-small", $("page").hasAttribute("data-small"));
  ok("4 张内容方向按钮高亮",
     doc.querySelector('#rxOrientSeg .seg-btn[data-rxorient="landscape"]').classList.contains("on"));

  /* ---- 1 张 = 纸张横 + 内容横 ---- */
  setMultiUp(1);
  ok("1 张 → A4 横向 + 内容横向",
     w().paper.orient === "landscape" && w().paper.rxOrient === "landscape");
  ok("1 张时 sheet 宽=210mm（处方纸本身）", $("sheet").style.width === "210mm", $("sheet").style.width);

  /* ---- 组合表回归锁定 ---- */
  const combo=(n)=>{ setMultiUp(n); return {sheet: w().paper.orient, rx: w().paper.rxOrient}; };
  const c1=combo(1), c2=combo(2), c4=combo(4);
  ok("组合表 1张=纸横/内容横", c1.sheet==="landscape" && c1.rx==="landscape");
  ok("组合表 2张=纸横/内容竖", c2.sheet==="landscape" && c2.rx==="portrait");
  ok("组合表 4张=纸横/内容横", c4.sheet==="landscape" && c4.rx==="landscape");
  setMultiUp(1);
  ok("收尾：回到单联", w().paper.multi === 1);

  console.log("\n=== 3. 新建处方 ===");
  w().hospital = "示例医院";
  w().pharmacy = "示例药房";
  w().doctor = "张医生";
  w().address = "示例地址";
  w().dept = "儿科门诊";
  w().note = "自定义说明文字";
  w().name = "旧患者";
  w().gender = "男";
  w().age = "30岁";
  w().diag = "感冒";
  w().card = "C001";
  w().date = "2000-01-01";
  w().drugs = [
    { cat: "Rp", name: "旧药品A", spec: "", dose: "1", dunit: "片", freq: "", usage: "口服", skin: false, price: "1", qty: "1", unit: "盒" },
    { cat: "Rp", name: "旧药品B", spec: "", dose: "2", dunit: "片", freq: "", usage: "口服", skin: false, price: "2", qty: "2", unit: "盒" }
  ];
  $("pasteBox").value = "残留内容";
  newRxTest();

  const todayStr = new Date().getFullYear() + "-" +
    String(new Date().getMonth() + 1).padStart(2, "0") + "-" +
    String(new Date().getDate()).padStart(2, "0");

  ok("患者姓名已清空", w().name === "");
  ok("性别已清空", w().gender === "");
  ok("年龄已清空", w().age === "");
  ok("诊断已清空", w().diag === "");
  ok("就诊卡号已清空", w().card === "");
  ok("药品已清空", (w().drugs || []).filter(d => d.name).length === 0);
  ok("日期重置为今天", w().date === todayStr, w().date + " vs " + todayStr);
  ok("保留医院名称", w().hospital === "示例医院", w().hospital);
  ok("保留发药药房", w().pharmacy === "示例药房", w().pharmacy);
  ok("保留处方医师", w().doctor === "张医生", w().doctor);
  ok("保留患者地址", w().address === "示例地址", w().address);
  ok("科别重置为默认值（普通内科）", w().dept === "普通内科", w().dept);
  ok("保留底部说明", w().note === "自定义说明文字", w().note);
  ok("预置一个空药品行", (w().drugs || []).length === 1 && !w().drugs[0].name);
  const nd = w().drugs[0];
  ok("新药品行：剂量单位默认片", nd.dunit === "片", nd.dunit);
  ok("新药品行：频次默认每日一次", nd.freq === "每日一次", nd.freq);
  ok("新药品行：用法默认口服", nd.usage === "口服", nd.usage);
  ok("新药品行：数量单位默认盒", nd.unit === "盒", nd.unit);
  ok("新药品行：无皮试字段", !("skin" in nd));
  ok("粘贴框已清空", $("pasteBox").value === "");
  ok("纸张设置保留", w().paper.multi === 1 && w().paper.orient === "landscape");

  console.log("\n=== 4. 导入手动匹配数据项 ===");
  ok("存在手动匹配开关", !!$("impManual"));
  ok("存在提示框", !!$("impManualHint"));
  openImport();
  ok("弹窗已打开", $("importMask").classList.contains("on"));
  /* 模拟解析结果：列名故意与自动别名不一致，验证手动映射 */
  window.eval("impHeader=['列甲','列乙','列丙','列丁']; impRows=[{列甲:'阿莫西林',列乙:'0.25g*24粒',列丙:'山东制药',列丁:'12.5'}]; impAutoMap={}; impFieldOn={}; impManual={};");
  renderImportFields();
  /* n 是必选字段，标签恒为「必选」；用可选字段 s 验证未匹配显示 */
  ok("必选字段标签为「必选」",
     doc.querySelector('.imp-field[data-fk="n"] .fkey').textContent === "必选");
  ok("未匹配的可选字段显示「未匹配」",
     doc.querySelector('.imp-field[data-fk="s"] .fkey').textContent === "未匹配",
     doc.querySelector('.imp-field[data-fk="s"] .fkey').textContent);
  ok("默认未开启手动模式", !$("impManual").checked);

  toggleManualMap(true);
  ok("勾选后提示框显示", $("impManualHint").style.display === "block");
  const sel = doc.querySelector('.imp-field[data-fk="n"] .col-sel');
  ok("出现列下拉框", !!sel);
  ok("下拉含所有源列", sel && sel.options.length === 5, sel ? sel.options.length + " 项(含不导入)" : "无");

  setManualCol("s", "列甲");
  ok("手动指定后字段标记 manual",
     doc.querySelector('.imp-field[data-fk="s"]').classList.contains("manual"));
  ok("标签显示「手动」",
     doc.querySelector('.imp-field[data-fk="s"] .fkey').textContent === "手动");
  ok("下拉回填为所选列", doc.querySelector('.imp-field[data-fk="s"] .col-sel').value === "列甲");
  ok("展示首行样例值",
     /阿莫西林/.test(doc.querySelector('.imp-field[data-fk="s"] .sample').textContent),
     doc.querySelector('.imp-field[data-fk="s"] .sample').textContent);

  setManualCol("n", "列甲");
  setManualCol("s", "列乙");
  setManualCol("m", "列丙");
  setManualCol("p", "列丁");
  ok("多字段手动映射生效",
     window.eval("impCol('n')") === "列甲" && window.eval("impCol('s')") === "列乙" &&
     window.eval("impCol('m')") === "列丙" && window.eval("impCol('p')") === "列丁");

  /* 验证 mapRow 使用手动映射 */
  const rec = mapRow(window.eval("impRows[0]"));
  ok("mapRow 读到手动映射的名称", rec.n === "阿莫西林", JSON.stringify(rec));
  ok("mapRow 读到规格", rec.s === "0.25g*24粒", rec.s);
  ok("mapRow 读到厂家", rec.m === "山东制药", rec.m);
  ok("mapRow 读到单价", String(rec.p) === "12.5", String(rec.p));

  clearManualMap();
  ok("清空匹配后字段回未匹配",
     doc.querySelector('.imp-field[data-fk="s"] .fkey').textContent === "未匹配",
     doc.querySelector('.imp-field[data-fk="s"] .fkey').textContent);

  /* autoFillUnmatched：列名与别名无关时应补不上 */
  autoFillUnmatched();
  ok("无关列名不会被误匹配", Object.keys(window.eval("impAutoMap")).length === 0);

  console.log("\n=== 6. 多联拼版：点击新处方跳下一联 ===");
  setMultiUp(2);
  ok("rxCount=2", rxCount() === 2, "实际 " + rxCount());

  /* 联切换栏应显示 */
  const rxBar = $("rxBar");
  ok("联切换栏可见", rxBar && rxBar.style.display === "flex");
  ok("联切换栏有 2 个按钮", rxBar.querySelectorAll(".rxbar-item").length === 2);
  ok("存在「下一联」跳转按钮", !!rxBar.querySelector(".rxbar-next"));
  ok("当前在第 1 联", rxBar.querySelectorAll(".rxbar-item")[0].classList.contains("on"));

  /* 给第 1 联录内容 */
  window.eval("state.name='患者甲'; state.gender='男'; state.age='30岁';");
  window.eval("state.drugs=[{cat:'Rp',name:'药品甲',spec:'',dose:'1',dunit:'片',freq:'每日三次',usage:'口服',skin:false,price:'10',qty:'2',unit:'盒'}];");
  fn("renderPreview")();
  ok("第 1 联预览含患者甲", /患者甲/.test($("page").innerHTML));

  /* 点击新处方 → 跳到第 2 联 */
  nextRxTest();
  ok("跳到第 2 联", w().activeRx === 1, "activeRx=" + w().activeRx);
  ok("第 2 联姓名为空", (fn("curRx")().name||"") === "");
  ok("第 1 联内容保留", w().name === "患者甲");
  ok("第 1 联药品保留", w().drugs[0].name === "药品甲");
  ok("联切换栏第 2 个按钮高亮",
     rxBar.querySelectorAll(".rxbar-item")[1].classList.contains("on"));
  ok("第 1 联标记为已录（filled）",
     rxBar.querySelectorAll(".rxbar-item")[0].classList.contains("filled"));

  /* 第 2 联录另一份 */
  window.eval("state.rxs[1].name='患者乙'; state.rxs[1].gender='女'; state.rxs[1].age='25岁';");
  window.eval("state.rxs[1].drugs=[{cat:'Rp',name:'药品乙',spec:'',dose:'2',dunit:'粒',freq:'每日两次',usage:'口服',skin:false,price:'20',qty:'1',unit:'盒'}];");
  fn("renderPreview")();
  ok("第 2 联预览含患者乙", /患者乙/.test($("page").innerHTML));

  /* 预览中两联内容各自独立：主节点=当前编辑联，克隆节点=另一联 */
  /* 注意：节点池在切联时会重建/复用节点，不能缓存引用，必须每次现查 */
  const cellsNow = doc.querySelectorAll("#sheet .sheet-cell");
  const cloneNode = [...cellsNow].map(c => c.querySelector(".rx-page")).find(p => p && p.id !== "page");
  ok("存在另一联的独立节点", !!cloneNode);
  ok("主节点承载当前编辑联（第2联·患者乙）", /患者乙/.test($("page").innerHTML));
  ok("克隆节点承载第 1 联（患者甲）", cloneNode && /患者甲/.test(cloneNode.innerHTML));
  ok("两联内容互不串扰", cloneNode && !/患者乙/.test(cloneNode.innerHTML));
  ok("第 1 联数据未丢失", window.eval("state.name") === "患者甲");

  /* 切回第 1 联 */
  goRx(0);
  ok("goRx 切回第 1 联", w().activeRx === 0);
  ok("第 1 联预览恢复患者甲", /患者甲/.test($("page").innerHTML));
  ok("表单回填第 1 联姓名", $("fName").value === "患者甲", $("fName").value);

  /* 切到第 2 联，表单应显示第 2 联内容 */
  goRx(1);
  ok("表单回填第 2 联姓名", $("fName").value === "患者乙", $("fName").value);
  ok("药品列表切到第 2 联", /药品乙/.test($("drugList").innerHTML));

  /* 共享字段全联同步 */
  window.eval("state.hospital='示例医院'");
  fn("renderPreview")();
  const cloneNow = [...doc.querySelectorAll("#sheet .sheet-cell")]
    .map(c => c.querySelector(".rx-page")).find(p => p && p.id !== "page");
  ok("医院名称两联共享",
     /示例医院/.test($("page").innerHTML) && cloneNow && /示例医院/.test(cloneNow.innerHTML));

  /* 最后一联再点新处方 → 回到第 1 联 */
  nextRxTest();
  ok("末联后回到第 1 联", w().activeRx === 0, "activeRx=" + w().activeRx);

  /* 切回单联模式（末联点新处方已回到并清空第 1 联） */
  setMultiUp(1);
  ok("单联时联切换栏隐藏", $("rxBar").style.display === "none");
  ok("单联回到第 1 联", w().activeRx === 0);
  ok("单联时抬头信息保留", /示例医院/.test($("page").innerHTML));
  ok("单联时使用第 1 联数据", (w().name||"") === "", "name=" + JSON.stringify(w().name));

  console.log("\n=== 7. 回归：纸张切换不影响预览渲染 ===");
  loadSample();
  ok("示例载入后药品 3 条", w().drugs.filter(d => d.name).length === 3);
  setMultiUp(2);
  ok("拼版下预览仍能渲染", $("page").innerHTML.indexOf("处方") >= 0);
  setMultiUp(1);
  ok("单页下预览仍能渲染", $("page").innerHTML.indexOf("处方") >= 0);

  console.log("\n=== 运行时错误 ===");
  const real = errors.filter(e => !/药品清单库|Cannot read property.*USER_DB|Could not parse CSS|labBar/i.test(e));
  ok("无未捕获的运行时错误", real.length === 0, real.slice(0, 3).join(" | "));

  console.log("\n========================================");
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  console.log("========================================");
  process.exit(fail ? 1 : 0);
}, 900);