'use strict';
import { trackWrite, trackRequest } from './saving.js';

async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* 非 JSON */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function write(method, path, body) {
  return trackWrite(`${method}:${path}`, request(method, path, body));
}

export const api = {
  get: (p) => trackRequest(request('GET', p)),
  post: (p, b) => write('POST', p, b),
  put: (p, b) => write('PUT', p, b),
  del: (p) => write('DELETE', p)
};
