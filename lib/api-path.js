'use strict';
function apiSegments(path) {
  return path.split('/').filter(Boolean).map(segment => {
    let value;
    try { value = decodeURIComponent(segment); }
    catch { throw Object.assign(new Error('invalid URL encoding'), { status: 400 }); }
    if (/[\/\\\u0000]/.test(value)) throw Object.assign(new Error('invalid path segment'), { status: 400 });
    return value;
  });
}
module.exports = { apiSegments };
