#!/usr/bin/env node
// Builds book.html from the spec appendix (S-18-01) and tools/book.template.html.
// Usage: node tools/build-book.js "<path to the spec .md>"
// The spec appendix is the source of truth for page text and prompts.
const fs = require('fs');
const path = require('path');

const specPath = process.argv[2];
if (!specPath) { console.error('usage: node tools/build-book.js <spec.md>'); process.exit(1); }

const md = fs.readFileSync(specPath, 'utf8').replace(/\r/g, '');
const appStart = md.indexOf('## נספח');
if (appStart < 0) throw new Error('appendix not found in spec');
const parts = md.slice(appStart).split(/^### /m).slice(1);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

// ---- cover (blockquote) ----
const coverPart = parts.find(p => p.startsWith('עמוד השער'));
const coverLines = coverPart.split('\n').slice(1)
  .filter(l => l.startsWith('>'))
  .map(l => l.replace(/^>\s?/, ''));
let coverTitle = '';
let coverHtml = '';
let inList = false;
for (const raw of coverLines) {
  const l = raw.trim();
  if (!l) { if (inList) { coverHtml += '</ul>\n'; inList = false; } continue; }
  if (l.startsWith('**מתחילים**')) continue; // developer note, replaced by the stage 0 heading
  const bullet = l.match(/^\* (.*)$/);
  if (bullet) {
    if (!inList) { coverHtml += '<ul>\n'; inList = true; }
    coverHtml += `<li>${inline(bullet[1])}</li>\n`;
    continue;
  }
  if (inList) { coverHtml += '</ul>\n'; inList = false; }
  const onlyBold = l.match(/^\*\*([^*]+)\*\*$/);
  if (onlyBold && !coverTitle) { coverTitle = onlyBold[1]; continue; }
  if (onlyBold) { coverHtml += `<h3>${esc(onlyBold[1])}</h3>\n`; continue; }
  coverHtml += `<p>${inline(l)}</p>\n`;
}
if (inList) coverHtml += '</ul>\n';

// ---- stages ----
function parseStage(part) {
  const lines = part.split('\n');
  const title = lines[0].trim();
  const blocks = [];
  let inCode = false, code = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === '```') {
      if (inCode) { blocks.push({ type: 'prompt', text: code.join('\n').replace(/\s+$/, '') }); code = []; }
      inCode = !inCode; continue;
    }
    if (inCode) { code.push(line); continue; }
    let m = line.match(/^\*\*הנחיה למשתמש(?: \(([^)]*)\))?:\*\*\s*(.*)$/);
    if (m) { blocks.push({ type: 'guide', sub: m[1] || '', html: inline(m[2]) }); continue; }
    m = line.match(/^\*\*(תוצר[^:]*):\*\*\s*(.*)$/);
    if (m) { blocks.push({ type: 'output', label: m[1], html: inline(m[2]) }); continue; }
  }
  return { title, blocks };
}

// ---- placeholders -> fields ----
function extractFields(promptText, screenKey, pIdx) {
  const fields = [];
  const lines = promptText.split('\n');
  const out = lines.map(line => line.replace(/\[([^\]\n]+)\]/g, (m, inner, offset) => {
    const id = `${screenKey}p${pIdx}f${fields.length}`;
    const isNew = /^אם זו שיחה חדשה/.test(inner);
    const isBlank = /^אפשר להשאיר ריק/.test(inner);
    let label = inner, hint = '';
    if (isNew) {
      label = 'אם זו שיחה חדשה, הדביקו כאן ' + inner.replace(/^אם זו שיחה חדשה:\s*/, '').replace(/^הדבק כאן\s*/, '').replace(/\.$/, '');
    } else if (isBlank) {
      label = line.slice(0, offset).replace(/[:\s]+$/, '');
      hint = 'אפשר להשאיר ריק';
    } else if (/^סטודנט\/ית להוראה/.test(inner)) {
      label = 'מי אתם'; hint = inner;
    }
    fields.push({ id, label, hint, optional: isNew || isBlank, big: isNew });
    return `{{${id}}}`;
  }));
  return { text: out.join('\n'), fields };
}

const screens = [];
let stageNo = null;
for (const part of parts) {
  const m = part.match(/^שלב (\d+): ([^\n(]+)/);
  if (!m) continue;
  const n = parseInt(m[1], 10);
  const stage = parseStage(part);
  const baseTitle = m[2].trim();
  const groups = [];
  if (n === 7) {
    const cut = stage.blocks.findIndex(b => b.type === 'guide' && /רפלקציה/.test(b.sub));
    groups.push({ key: 's7a', nav: '7א. שלד היוזמה', title: 'שלד היוזמה', stage: '7א', blocks: stage.blocks.slice(0, cut) });
    groups.push({ key: 's7b', nav: '7ב. רפלקציה על התהליך', title: 'רפלקציה על התהליך', stage: '7ב', blocks: stage.blocks.slice(cut) });
  } else {
    groups.push({
      key: 's' + n, nav: `${n}. ${baseTitle}`,
      title: baseTitle, stage: String(n), blocks: stage.blocks
    });
  }
  for (const g of groups) {
    let pIdx = 0;
    g.blocks = g.blocks.map(b => {
      if (b.type !== 'prompt') return b;
      const ex = extractFields(b.text, g.key, pIdx++);
      return { type: 'prompt', text: ex.text, fields: ex.fields };
    });
    screens.push(g);
  }
}

screens.unshift({ key: 'cover', nav: 'שער', title: 'שער', stage: 'שער', blocks: [] });
const data = { coverTitle, coverHtml, screens };
const tpl = fs.readFileSync(path.join(__dirname, 'book.template.html'), 'utf8');
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const html = tpl.replace('/*__DATA__*/null', () => json);
fs.writeFileSync(path.join(__dirname, '..', 'book.html'), html);
const nPrompts = screens.reduce((a, s) => a + s.blocks.filter(b => b.type === 'prompt').length, 0);
const nFields = screens.reduce((a, s) => a + s.blocks.reduce((b, x) => b + (x.fields ? x.fields.length : 0), 0), 0);
console.log(`book.html built: ${screens.length} screens, ${nPrompts} prompts, ${nFields} fields`);
