import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/css/base.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function tokens(block) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/gi)].map((m) => [m[1], m[2]]));
}
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('浅色和深色主题的正文、辅助文字、导航与主要按钮具有可读对比度', () => {
  const light = tokens(css.match(/:root\s*\{([^}]+)\}/)[1]);
  const dark = { ...light, ...tokens(css.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/)[1]) };
  for (const [name, theme] of [['浅色', light], ['深色', dark]]) {
    for (const [fg, bg] of [['--text', '--panel'], ['--muted', '--panel'], ['--muted', '--bg'], ['--primary', '--primary-soft'], ['--primary-ink', '--primary'], ['--primary-ink', '--primary-dark']]) {
      assert.ok(contrast(theme[fg], theme[bg]) >= 4.5, `${name} ${fg}/${bg} 对比度不足`);
    }
  }
});

test('七个导航在文字隐藏时仍有独立图标、可访问名称和提示', () => {
  const links = [...html.matchAll(/<a\b([^>]*data-route[^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 7);
  for (const [, attrs, content] of links) {
    const label = attrs.match(/aria-label="([^"]+)"/);
    assert.ok(label?.[1]);
    assert.ok(attrs.includes(`title="${label[1]}"`));
    assert.match(content, /<svg[^>]*class="nav-icon"[^>]*aria-hidden="true"/);
    assert.ok(content.includes(`<span class="nav-label">${label[1]}</span>`));
  }
});
