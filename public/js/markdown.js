'use strict';
import { escapeHtml } from './utils.js';

// 行内 Markdown → HTML（输入先转义，避免 XSS）
export function renderInline(text) {
  let s = escapeHtml(text);
  const codes = [];
  // 先把行内代码抽出来保护，避免其中的 * _ 被解析
  s = s.replace(/`([^`]+)`/g, (m, p1) => {
    codes.push(p1);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
}

// 块级 + 行内 Markdown → HTML
export function renderMarkdown(text) {
  if (text === null || text === undefined) return '';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { type: 'ul'|'ol', items: [] }

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>${list.items.join('')}</${list.type}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushPara(); flushList(); continue; }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara(); flushList();
      const lvl = heading[1].length;
      out.push(`<h${lvl}>${renderInline(heading[2])}</h${lvl}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara(); flushList();
      out.push('<hr>');
      continue;
    }

    const todo = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (todo) {
      flushPara();
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      const done = todo[1].toLowerCase() === 'x';
      list.items.push(`<li class="md-todo${done ? ' done' : ''}">${done ? '☑' : '☐'} ${renderInline(todo[2])}</li>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      flushPara();
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(`<li>${renderInline(numbered[1])}</li>`);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara(); flushList();
      out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    flushList();
    para.push(line);
  }

  flushPara();
  flushList();
  return out.join('');
}
