import { Marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

function escapeHtml(raw = '') {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const safeMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Raw HTML from untrusted remote sessions is always displayed as escaped text, never executed.
    html(token) {
      const raw = typeof token === 'string' ? token : (token?.raw || token?.text || '');
      return `<span class="remote-escaped-html">${escapeHtml(raw)}</span>`;
    },
    image(token) {
      const alt = typeof token === 'object' ? (token.text || 'image') : 'image';
      const href = typeof token === 'object' ? (token.href || '') : '';
      return `<span class="remote-file-Chip">🖼 ${escapeHtml(alt)}${href ? ` (${escapeHtml(href)})` : ''}</span>`;
    },
    link(token) {
      const href = String(token?.href || '').trim();
      const label = escapeHtml(token?.text || href);
      if (/^https:\/\//i.test(href)) {
        return `<a class="remote-safe-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
      // Workspace or local paths become safe non-navigating file pills
      return `<code class="remote-path-pill" title="${escapeHtml(href)}">📄 ${label}</code>`;
    },
    code(token) {
      const codeText = typeof token === 'string' ? token : (token?.text || '');
      const langRaw = (typeof token === 'object' ? (token?.lang || '') : '').trim().split(/\s+/)[0];
      const language = langRaw && hljs.getLanguage(langRaw) ? langRaw : 'plaintext';
      const highlighted = hljs.highlight(codeText, { language }).value;
      const badge = langRaw ? escapeHtml(langRaw) : 'text';
      return `<div class="remote-code-block"><div class="remote-code-header"><span class="remote-code-lang">${badge}</span></div><pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></div>`;
    },
  },
});

export function renderSafeRemoteMarkdown(text) {
  if (!text) return '';
  const rawHtml = safeMarked.parse(String(text));
  if (typeof DOMPurify?.sanitize === 'function') {
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
        'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'span', 'div', 'a',
      ],
      ALLOWED_ATTR: ['class', 'title', 'href', 'target', 'rel'],
      ALLOW_DATA_ATTR: false,
    });
  }
  return rawHtml;
}

export function inferArtifactKind(nameOrPath = '') {
  const clean = String(nameOrPath).split(/[?#]/)[0];
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  if (['csv', 'tsv'].includes(ext)) return 'csv';
  if (['md', 'markdown', 'txt'].includes(ext)) return 'markdown';
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return 'data';
  if (['py', 'js', 'ts', 'vue', 'rs', 'sh', 'ovpn', 'html', 'css', 'sql'].includes(ext)) return 'code';
  return 'file';
}

export function extractMessageArtifacts(message) {
  if (!message) return [];
  const items = [];
  const seen = new Set();

  const addItem = (item) => {
    const key = item.path || item.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    const name = item.name || String(item.path).split(/[/\\]/).pop() || key;
    items.push({
      id: `${message.id || 'msg'}:${key}`,
      name,
      path: item.path || name,
      kind: item.kind || inferArtifactKind(name),
      description: item.description || '',
      content: item.content || '',
    });
  };

  if (Array.isArray(message.artifacts)) {
    for (const art of message.artifacts) addItem(art);
  }

  const text = String(message.text || '');
  // Extract Markdown file references e.g. [label](</home/.../file.csv>) or [file.py](/home/.../file.py)
  const linkRegex = /\[([^\]]+)\]\(<?(\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})>?\)/g;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    addItem({
      name: match[1].trim(),
      path: match[2].trim(),
      kind: inferArtifactKind(match[2]),
    });
  }

  // Extract inline code absolute paths e.g. `/home/bobbik/dsh_projects/network/openvpn_nodes_test.csv`
  const inlinePathRegex = /`(\/(?:home|tmp|srv|opt|var|etc)\/[A-Za-z0-9_./-]+\.(?:csv|py|md|json|yaml|yml|sh|ovpn|html|txt|log))`/g;
  while ((match = inlinePathRegex.exec(text)) !== null) {
    const p = match[1];
    addItem({
      name: p.split('/').pop(),
      path: p,
      kind: inferArtifactKind(p),
    });
  }

  // Extract substantial fenced code blocks (e.g., csv/markdown/python/json) as previewable inline artifacts
  const fenceRegex = /```([A-Za-z0-9_-]+)?\n([\s\S]*?)```/g;
  let fenceIdx = 1;
  while ((match = fenceRegex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const body = (match[2] || '').trim();
    if (body.split('\n').length >= 4 && ['csv', 'markdown', 'md', 'json', 'python', 'py', 'bash', 'sh'].includes(lang)) {
      const extMap = { python: 'py', markdown: 'md', bash: 'sh' };
      const ext = extMap[lang] || lang;
      const name = `snippet-${fenceIdx}.${ext}`;
      addItem({
        name,
        path: name,
        kind: inferArtifactKind(name),
        description: `${lang.toUpperCase()} (${body.split('\n').length} lines)`,
        content: body,
      });
      fenceIdx += 1;
    }
  }

  return items;
}

export function formatSessionTitle(session) {
  if (!session) return '';
  const raw = String(session.title || session.sessionId || '').trim();
  const uuidMatch = raw.match(/^session-([0-9a-f]{8})-[0-9a-f-]{27}$/i) || raw.match(/^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  if (uuidMatch) {
    return `会话 #${uuidMatch[1].slice(0, 6)}`;
  }
  return raw;
}

export function formatSessionTime(updatedAt) {
  if (!updatedAt) return '';
  const ms = updatedAt > 1e12 ? updatedAt : updatedAt * 1000;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d`;
  return `${Math.floor(diffSec / (86400 * 30))}mo`;
}

export function parseCsvPreview(text, maxRows = 50) {
  if (!text) return { headers: [], rows: [] };
  const lines = String(text)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, maxRows + 1);
  if (!lines.length) return { headers: [], rows: [] };
  const splitLine = line => line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''));
  return {
    headers: splitLine(lines[0]),
    rows: lines.slice(1).map(splitLine),
  };
}
