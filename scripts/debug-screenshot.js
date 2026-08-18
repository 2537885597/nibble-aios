/**
 * 临时调试脚本：把桌宠窗口渲染出来并截图保存，方便在不打开真实窗口的情况下检查外观。
 * 用法：electron scripts/debug-screenshot.js
 * 完成后会自动退出。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 260,
    height: 360,
    show: true,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: false,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'pet', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 600));
  const image = await win.webContents.capturePage();
  const outPath = path.join(__dirname, '..', 'debug-screenshot.png');
  fs.writeFileSync(outPath, image.toPNG());
  console.log('已保存截图到', outPath);
  app.quit();
});
