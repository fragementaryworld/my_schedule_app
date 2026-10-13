'use strict';
const { spawn } = require('child_process');

// 用系统默认浏览器打开地址（不等待、不捕获输出）
function open(url, { platform = process.platform, spawnProcess = spawn } = {}) {
  let cmd;
  let args;
  if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  // DETACHED_PROCESS creates a separate console on Windows, even with hidden
  // stdio. Unref and disconnected stdio are enough for this short-lived helper.
  const child = spawnProcess(cmd, args, { stdio: 'ignore', detached: platform !== 'win32', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

module.exports = { open };
