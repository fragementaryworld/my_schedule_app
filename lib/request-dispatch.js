'use strict';

const bodies = new WeakMap();

function readBody(req, limit = 5 * 1024 * 1024) {
  if (bodies.has(req)) return Promise.resolve(bodies.get(req));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const error = (status, message) => Object.assign(new Error(message), { status });
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(error(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'JSON object required');
        bodies.set(req, body);
        resolve(body);
      } catch (e) { reject(e.status ? e : error(400, 'invalid json')); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(error(400, 'request aborted')));
  });
}

// 慢上传不占用状态队列；完整请求进入队列后才取得数据，避免导入后的旧引用。
function createDispatcher(store, handle) {
  let tail = Promise.resolve();
  const enqueue = operation => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  const dispatch = async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/')) return handle(req, res, store);
    const writes = !['GET', 'HEAD'].includes(req.method);
    if (writes) await readBody(req);
    return enqueue(async () => {
      if (req.aborted || res.destroyed) return;
      let status, headers, body;
      const staged = {
        writeHead(code, values) { status = code; headers = values; },
        end(value) { body = value; }
      };
      const run = () => handle(req, staged, store);
      // 查询重复任务可能生成实例，也必须原子提交，并合并整个范围的磁盘写入。
      if (writes || path === '/api/tasks') await store.transaction(run);
      else await run();
      if (!res.destroyed) {
        res.writeHead(status, headers);
        res.end(body);
      }
    });
  };
  dispatch.run = enqueue;
  return dispatch;
}

module.exports = { readBody, createDispatcher };
