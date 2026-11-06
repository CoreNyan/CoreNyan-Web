import fs from 'fs';
import path from 'path';

export class SkillService {
  constructor(skillsDir) {
    this.skillsDir = skillsDir;
  }

  // Get catalog of skills for system instructions
  getCatalog() {
    if (!fs.existsSync(this.skillsDir)) return [];
    const skills = [];

    const scan = (dir, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scan(full, prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const relPath = (prefix ? `${prefix}/` : '') + entry.name;
          const id = relPath.replace(/\.md$/, '');
          try {
            const stat = fs.statSync(full);
            const raw = fs.readFileSync(full, 'utf-8');
            const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const firstLine = (lines[0] || '').replace(/^#*\s*/, '').trim();
            const secondLine = (lines[1] || '').replace(/^[-*>#]+\s*/, '').trim();
            skills.push({
              id,
              name: id,
              relPath,
              file: full,
              size: stat.size,
              updatedAt: stat.mtimeMs,
              description: firstLine || secondLine || id
            });
          } catch(e) {}
        }
      }
    };

    scan(this.skillsDir);
    return skills;
  }

  // Load the full content of a skill
  loadSkill(skillName) {
    const directPath = path.join(this.skillsDir, skillName.endsWith('.md') ? skillName : `${skillName}.md`);
    if (fs.existsSync(directPath)) {
      return fs.readFileSync(directPath, 'utf-8');
    }

    // Try finding recursively
    const catalog = this.getCatalog();
    const found = catalog.find(s => s.name === skillName || s.name.endsWith(skillName) || s.name.includes(skillName));
    if (found && fs.existsSync(found.file)) {
      return fs.readFileSync(found.file, 'utf-8');
    }

    return null;
  }
}
