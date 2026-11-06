import fs from 'fs';
import path from 'path';

export class MemoryService {
  constructor(vaultDir) {
    this.vaultDir = vaultDir;
  }

  // Scan and search memory cards from CoreNyan's memory-vault
  async recall(query, limit = 5) {
    if (!fs.existsSync(this.vaultDir)) {
      return [];
    }

    const cards = [];
    const scan = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scan(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            const content = fs.readFileSync(full, 'utf-8');
            const relPath = path.relative(this.vaultDir, full).replace(/\\/g, '/');
            cards.push({ path: relPath, content });
          } catch(e) {}
        }
      }
    };

    scan(this.vaultDir);

    if (!query || query === '*' || query.trim() === '') {
      return cards.slice(0, limit);
    }

    // Keyword relevance score
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = cards.map(c => {
      const lower = (c.path + ' ' + c.content).toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (c.path.toLowerCase().includes(kw)) score += 10;
        const matches = lower.split(kw).length - 1;
        score += matches;
      }
      return { ...c, score };
    }).filter(c => c.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // Save or deposit new memory card
  async saveCard(relPath, content) {
    const root = path.resolve(this.vaultDir);
    const fullPath = path.resolve(root, String(relPath || ''));
    if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
      throw new Error('Memory path escapes vault root');
    }
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${fullPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, fullPath);
    return { success: true, path: relPath, status: 'pending' };
  }

  // Alias for tool-registry.js memory_save ({ title, content, tags })
  async save({ title, content, tags = [] }) {
    const safeSlug = String(title || `card-${Date.now()}`)
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim();
    const relPath = `03-Knowledge/${safeSlug.endsWith('.md') ? safeSlug : safeSlug + '.md'}`;
    const tagHeader = Array.isArray(tags) && tags.length > 0 ? `> Tags: ${tags.join(', ')}\n\n` : '';
    const fullText = `# ${title}\n\n${tagHeader}${content || ''}\n`;
    return this.saveCard(relPath, fullText);
  }

  // List memory cards for Settings panel
  listCards(limit = 200) {
    if (!fs.existsSync(this.vaultDir)) return [];
    const cards = [];
    const scan = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scan(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            const stat = fs.statSync(full);
            const relPath = path.relative(this.vaultDir, full).replace(/\\/g, '/');
            const parts = relPath.split('/');
            const scope = parts.length > 1 ? parts[0] : '根目录';
            const raw = fs.readFileSync(full, 'utf-8');
            const firstHeading = raw.split(/\r?\n/).find(l => l.trim().startsWith('#'));
            const title = firstHeading
              ? firstHeading.replace(/^#+\s*/, '').trim()
              : entry.name.replace(/\.md$/, '');
            cards.push({
              id: relPath,
              title,
              relPath,
              scope,
              size: stat.size,
              updatedAtMs: stat.mtimeMs,
              updatedAt: new Date(stat.mtimeMs).toLocaleString('zh-CN', { hour12: false })
            });
          } catch (e) {}
        }
      }
    };
    scan(this.vaultDir);
    cards.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
    return cards.slice(0, limit);
  }
}
