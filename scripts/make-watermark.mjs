import puppeteer from "puppeteer";
import { writeFileSync } from "fs";
const W = 1275, H = 1650; // 8.5x11 at 150dpi (page aspect)
const html = `<!doctype html><html><head><style>
  html,body{margin:0;padding:0;background:transparent;}
  .wrap{width:${W}px;height:${H}px;display:flex;align-items:center;justify-content:center;overflow:hidden;}
  .wm{transform:rotate(-48deg);font-family:Arial,Helvetica,sans-serif;font-weight:800;
      font-size:112px;letter-spacing:1px;color:#C4C4C4;white-space:nowrap;}
</style></head><body><div class="wrap"><div class="wm">UNCONTROLLED COPY</div></div></body></html>`;
const b = await puppeteer.launch({ args:["--no-sandbox","--disable-setuid-sandbox"], headless:true });
const p = await b.newPage();
await p.setViewport({ width:W, height:H, deviceScaleFactor:1 });
await p.setContent(html, { waitUntil:"networkidle0" });
const buf = await p.screenshot({ omitBackground:true, clip:{x:0,y:0,width:W,height:H} });
await b.close();
const base = "C:/Users/veril/AppData/Local/Temp/claude/C--Users-veril/76f2cc96-752b-49d6-be5b-616759d60139/scratchpad/";
writeFileSync(base+"watermark.png", buf);
writeFileSync(base+"watermark.b64", buf.toString("base64"));
console.log("bytes:", buf.length);
