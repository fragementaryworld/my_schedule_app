'use strict';
const { createApp } = require('./lib/api');
const { open } = require('./open-browser');

const PORT = Number(process.env.PORT) || 4321;

const server = createApp();

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`工作生活 App 已启动：${url}`);
  console.log('按 Ctrl+C 停止服务。');
  if (process.env.NO_BROWSER !== '1') {
    setTimeout(() => open(url), 400);
  }
});
