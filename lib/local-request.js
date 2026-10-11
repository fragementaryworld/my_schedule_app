'use strict';
const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };

function assertLocalApiRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) reject(403, '仅允许本机访问数据。');
  let host;
  try { host = new URL(`http://${req.headers.host}`); }
  catch { reject(403, '无效本机 Host。'); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || host.username || host.password) reject(403, '仅允许本机 Host。');
  if (req.headers.origin && req.headers.origin !== host.origin) reject(403, '不允许其他网站访问数据。');
  if (req.headers['sec-fetch-site'] === 'cross-site') reject(403, '不允许跨站访问数据。');
  if (!['GET', 'HEAD'].includes(req.method)) {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
    // 兼容无请求体的删除、手动保存；任何带内容的写入必须是 JSON。
    if ((type && type !== 'application/json') || (hasBody && type !== 'application/json')) reject(415, '数据写入需要 JSON 请求。');
  }
}
module.exports = { assertLocalApiRequest };
