/**
 * Documentation site generator.
 *
 * Renders every markdown file in `docs/` into a styled, self-contained HTML
 * site in `docs-site/`.
 *
 * Generated rather than hand-written, so the HTML cannot drift from the
 * markdown. The markdown stays the source of truth — it is what lives beside the
 * code and gets reviewed in pull requests — and the HTML is what gets sent to
 * the client.
 *
 * No dependencies. A markdown library would be one more thing to keep current
 * for output this predictable, and the subset we use is small.
 *
 * Run with:  node scripts/build-docs.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(root, 'docs');
const outDir = join(root, 'docs-site');

// ─────────────────────────────────────────────────────────────
// Minimal markdown renderer
// ─────────────────────────────────────────────────────────────

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const target = href.replace(/\.md$/, '.html');
      const external = /^https?:/.test(target);
      return `<a href="${target}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
    });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function renderMarkdown(markdown) {
  const lines = markdown.split('\n');
  const html = [];
  const headings = [];

  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    // Fenced code
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(
        `<pre class="code"${language ? ` data-lang="${language}"` : ''}><code>${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // Tables
    if (line.includes('|') && lines[index + 1]?.match(/^\s*\|?[\s:|-]+\|/)) {
      const parseRow = (row) =>
        row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

      const header = parseRow(line);
      index += 2;
      const body = [];
      while (index < lines.length && lines[index].includes('|')) {
        body.push(parseRow(lines[index]));
        index += 1;
      }

      html.push(
        `<div class="table-wrap"><table><thead><tr>${
          header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')
        }</tr></thead><tbody>${
          body
            .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
            .join('')
        }</tbody></table></div>`,
      );
      continue;
    }

    // Headings
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/[*`]/g, '');
      const id = slugify(text);
      if (level === 2 || level === 3) headings.push({ level, text, id });
      html.push(`<h${level} id="${id}">${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith('> ')) {
        quote.push(lines[index].slice(2));
        index += 1;
      }
      html.push(`<blockquote>${renderInline(quote.join(' '))}</blockquote>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      html.push('<hr>');
      index += 1;
      continue;
    }

    // Lists
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((i) => `<li>${renderInline(i)}</li>`).join('')}</${tag}>`);
      continue;
    }

    // Paragraph
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() !== '' && !/^(#|>|```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length) html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }

  return { html: html.join('\n'), headings };
}

// ─────────────────────────────────────────────────────────────
// Page shell
// ─────────────────────────────────────────────────────────────

const STYLES = `
:root{
  --brand-900:#241536; --brand-700:#3E2465; --brand-600:#5B3A8E;
  --brand-300:#B49FD6; --brand-100:#EDE6F7; --brand-50:#F6F2FB;
  --green-700:#166B41; --green-100:#DFF3E7;
  --amber-700:#8A5A12; --amber-100:#FDF0DA;
  --red-700:#B3402E; --red-100:#FBE9E5;
  --ink:#211A2C; --soft:#5A5266; --line:#E3E0EC;
  --surface:#fff; --canvas:#F7F6FA;
}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);
  font:16px/1.65 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
@media(max-width:900px){.layout{grid-template-columns:1fr}.sidebar{position:static;height:auto}}

.sidebar{background:var(--brand-900);color:#fff;padding:24px 0;position:sticky;top:0;height:100vh;overflow-y:auto}
.brand{display:flex;align-items:center;gap:10px;padding:0 22px 20px}
.brand-mark{width:34px;height:34px;border-radius:9px;flex:none;
  background:linear-gradient(150deg,#1F8A54,#5B3A8E);
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px}
.brand-name{font-weight:700;font-size:15px;letter-spacing:-.01em}
.brand-sub{font-size:11px;color:var(--brand-300)}
.nav-group{padding:14px 22px 4px;font-size:11px;text-transform:uppercase;
  letter-spacing:.09em;color:var(--brand-300)}
.sidebar a{display:block;padding:7px 22px;color:#E6DEF4;text-decoration:none;font-size:14px}
.sidebar a:hover{background:rgba(255,255,255,.07)}
.sidebar a.active{background:rgba(255,255,255,.14);font-weight:600;color:#fff;
  box-shadow:inset 3px 0 0 #1F8A54}

.content{padding:48px 56px 96px;max-width:940px}
@media(max-width:900px){.content{padding:28px 20px 64px}}

h1,h2,h3,h4{font-family:"Space Grotesk",Inter,sans-serif;letter-spacing:-.015em;
  color:var(--brand-900);line-height:1.25}
h1{font-size:34px;margin:0 0 8px}
h2{font-size:23px;margin:44px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
h3{font-size:17px;margin:28px 0 8px}
h4{font-size:15px;margin:20px 0 6px;color:var(--soft)}
p{margin:0 0 14px}
a{color:var(--brand-600)}
strong{color:var(--brand-900)}
hr{border:0;border-top:1px solid var(--line);margin:32px 0}

ul,ol{margin:0 0 16px;padding-left:22px}
li{margin-bottom:5px}

code{background:var(--brand-50);border:1px solid var(--brand-100);border-radius:4px;
  padding:1px 5px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.87em;
  color:var(--brand-700)}
pre.code{background:var(--brand-900);color:#E9E3F5;padding:16px 18px;border-radius:12px;
  overflow-x:auto;margin:0 0 18px;font-size:13px;line-height:1.6;position:relative}
pre.code code{background:none;border:0;padding:0;color:inherit;font-size:inherit}
pre.code[data-lang]::before{content:attr(data-lang);position:absolute;top:8px;right:12px;
  font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--brand-300)}

blockquote{margin:0 0 18px;padding:12px 18px;background:var(--brand-50);
  border-left:3px solid var(--brand-600);border-radius:0 8px 8px 0;color:var(--brand-700)}

.table-wrap{overflow-x:auto;margin:0 0 20px}
table{border-collapse:collapse;width:100%;font-size:14px;background:var(--surface);
  border:1px solid var(--line);border-radius:10px;overflow:hidden}
th{background:var(--brand-50);text-align:left;padding:10px 13px;font-weight:600;
  color:var(--brand-900);border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:10px 13px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}

.toc{background:var(--surface);border:1px solid var(--line);border-radius:12px;
  padding:16px 20px;margin:0 0 32px}
.toc-title{font-size:11px;text-transform:uppercase;letter-spacing:.09em;
  color:var(--soft);margin-bottom:8px}
.toc ul{list-style:none;padding:0;margin:0}
.toc li{margin-bottom:3px;font-size:14px}
.toc li.sub{padding-left:16px;font-size:13px}
.toc a{text-decoration:none}
.toc a:hover{text-decoration:underline}

.doc-footer{margin-top:64px;padding-top:20px;border-top:1px solid var(--line);
  font-size:13px;color:var(--soft);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
`;

function page({ title, bodyHtml, headings, nav, activePath, depth }) {
  const prefix = '../'.repeat(depth);

  const navHtml = nav
    .map(
      (group) => `
      <div class="nav-group">${group.label}</div>
      ${group.items
        .map(
          (item) =>
            `<a href="${prefix}${item.path}"${item.path === activePath ? ' class="active"' : ''}>${item.title}</a>`,
        )
        .join('')}`,
    )
    .join('');

  const toc =
    headings.length > 2
      ? `<nav class="toc"><div class="toc-title">On this page</div><ul>${headings
          .map((h) => `<li class="${h.level === 3 ? 'sub' : ''}"><a href="#${h.id}">${h.text}</a></li>`)
          .join('')}</ul></nav>`
      : '';

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Karsons Pharmacy Platform</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${STYLES}</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">K</div>
      <div>
        <div class="brand-name">Karsons Platform</div>
        <div class="brand-sub">Documentation</div>
      </div>
    </div>
    ${navHtml}
  </aside>
  <main class="content">
    ${toc}
    ${bodyHtml}
    <div class="doc-footer">
      <span>Karsons Pharmacy Platform</span>
      <span>Generated from source — do not edit HTML directly</span>
    </div>
  </main>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full, base));
    else if (entry.endsWith('.md')) files.push(relative(base, full));
  }
  return files;
}

function titleOf(markdown, fallback) {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match ? match[1].replace(/[*`]/g, '') : fallback;
}

const GROUP_LABELS = {
  '.': 'Overview',
  architecture: 'Architecture',
  modules: 'Modules',
  'client-guides': 'For pharmacy staff',
  deployment: 'Deployment',
};

const GROUP_ORDER = ['.', 'architecture', 'modules', 'deployment', 'client-guides'];

const files = walk(docsDir);
const pages = files.map((file) => {
  const markdown = readFileSync(join(docsDir, file), 'utf8');
  const group = dirname(file);
  return {
    file,
    group,
    path: file.replace(/\.md$/, '.html'),
    title: titleOf(markdown, basename(file, '.md')),
    markdown,
    depth: group === '.' ? 0 : group.split('/').length,
  };
});

const nav = GROUP_ORDER.filter((group) => pages.some((p) => p.group === group)).map((group) => ({
  label: GROUP_LABELS[group] ?? group,
  items: pages
    .filter((p) => p.group === group)
    .sort((a, b) => a.title.localeCompare(b.title)),
}));

mkdirSync(outDir, { recursive: true });

for (const p of pages) {
  const { html, headings } = renderMarkdown(p.markdown);
  const outPath = join(outDir, p.path);
  mkdirSync(dirname(outPath), { recursive: true });

  writeFileSync(
    outPath,
    page({
      title: p.title,
      bodyHtml: html,
      headings,
      nav,
      activePath: p.path,
      depth: p.depth,
    }),
  );
}

// Landing page
const indexPage = pages.find((p) => p.file === 'index.md');
if (!indexPage) {
  const first = pages.find((p) => p.group === 'architecture') ?? pages[0];
  writeFileSync(
    join(outDir, 'index.html'),
    `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${first.path}">`,
  );
}

console.log(`Built ${pages.length} pages into docs-site/`);
for (const group of nav) {
  console.log(`  ${group.label}: ${group.items.map((i) => i.title).join(', ')}`);
}
