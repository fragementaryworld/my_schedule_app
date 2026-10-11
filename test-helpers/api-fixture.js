'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../lib/api');

async function apiFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-api-'));
  const file = path.join(directory, 'data.json');
  const server = createApp({ dataFile: file });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const request = async (method, route, body) => {
    const response = await fetch(base + route, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  return { server, file, base, request };
}
module.exports = { apiFixture };
