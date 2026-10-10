'use strict';
const { createApp } = require('./lib/api');
const { open } = require('./open-browser');

const PORT = process.env.PORT === undefined ? 4321 : Number(process.env.PORT);

const server = createApp({
  ...(process.env.DATA_FILE ? { dataFile: process.env.DATA_FILE } : {}),
  onShutdown: () => console.log('数据已保存，服务已结束。')
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${server.address().port}/`;
  console.log(`工作生活 App 已启动：${url}`);
  console.log('按 Ctrl+C 停止服务。');
  if (process.env.NO_BROWSER !== '1') {
    setTimeout(() => open(url), 400).unref();
  }
});
