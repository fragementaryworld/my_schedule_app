'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { open } = require('../open-browser');

test('Windows 打开浏览器的辅助进程隐藏窗口且不创建 detached 控制台', () => {
  let invocation, unrefs = 0;
  const child = new EventEmitter(); child.unref = () => { unrefs++; };
  open('http://localhost:4321/', { platform: 'win32', spawnProcess: (...args) => { invocation = args; return child; } });
  assert.deepEqual(invocation.slice(0, 2), ['cmd', ['/c', 'start', '', 'http://localhost:4321/']]);
  assert.equal(invocation[2].windowsHide, true); assert.equal(invocation[2].detached, false); assert.equal(invocation[2].stdio, 'ignore');
  assert.equal(unrefs, 1); assert.doesNotThrow(() => child.emit('error', new Error('未找到浏览器')));
});

test('其他平台保留系统浏览器入口，不等待浏览器退出', () => {
  for (const [platform, executable] of [['darwin', 'open'], ['linux', 'xdg-open']]) {
    let invocation, released = false; const child = new EventEmitter(); child.unref = () => { released = true; };
    open('http://localhost:4321/', { platform, spawnProcess: (...args) => { invocation = args; return child; } });
    assert.equal(invocation[0], executable); assert.deepEqual(invocation[1], ['http://localhost:4321/']);
    assert.equal(invocation[2].detached, true); assert.equal(released, true);
  }
});
