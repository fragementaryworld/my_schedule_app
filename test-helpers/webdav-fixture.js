'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

async function webdavFixture(t) {
  const state = { text: null, calls: [], status: 0, etagStyle: 'strong', beforePut: null, holdGet: null };
  const etag = () => '"' + crypto.createHash('sha256').update(state.text || '').digest('hex') + '"';
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    state.calls.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.headers.authorization !== 'Basic ' + Buffer.from('tester:synthetic-password').toString('base64')) { res.writeHead(401); return res.end(); }
    if (state.status) { res.writeHead(state.status, { Location: '/elsewhere/' }); return res.end(); }
    if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); return res.end('<d:multistatus xmlns:d="DAV:"/>'); }
    if (req.method === 'GET') {
      if (state.holdGet) { const hold = state.holdGet; state.holdGet = null; hold.enter(); await hold.wait; }
      if (state.text === null) { res.writeHead(404); return res.end(); }
      const headers = { 'Content-Type': 'application/json' };
      if (state.etagStyle !== 'none') headers.ETag = (state.etagStyle === 'weak' ? 'W/' : '') + etag();
      res.writeHead(200, headers); return res.end(state.text);
    }
    if (req.method === 'PUT') {
      state.beforePut?.(); state.beforePut = null;
      if ((req.headers['if-none-match'] === '*' && state.text !== null) || (req.headers['if-match'] && req.headers['if-match'] !== etag())) { res.writeHead(412); return res.end(); }
      state.text = body; res.writeHead(201, { ETag: etag() }); return res.end();
    }
    res.writeHead(405); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { state, url: `http://127.0.0.1:${server.address().port}/dav/`,
    config: () => ({ url: `http://127.0.0.1:${server.address().port}/dav/`, username: 'tester', password: 'synthetic-password', enabled: true, intervalMinutes: 5 }),
    set(data) { state.text = data === null ? null : JSON.stringify(data); },
    hold() {
      let enter, release;
      const entered = new Promise(resolve => { enter = resolve; });
      const wait = new Promise(resolve => { release = resolve; });
      state.holdGet = { enter, wait }; return { entered, release };
    }
  };
}
module.exports = { webdavFixture };
