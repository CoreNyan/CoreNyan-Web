import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

export class PluginManager {
  constructor(pluginsDir) {
    this.pluginsDir = pluginsDir;
    this.plugins = new Map(); // id -> { manifest, instance, enabled }
  }

  async loadPlugins() {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pDir = path.join(this.pluginsDir, entry.name);
        const manifestFile = path.join(pDir, 'manifest.json');
        if (fs.existsSync(manifestFile)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
            const mainFile = path.join(pDir, manifest.main || 'index.js');
            let instance = null;
            if (fs.existsSync(mainFile) && manifest.enabled !== false) {
              const fileUrl = `${pathToFileURL(mainFile).href}?t=${Date.now()}`;
              const mod = await import(fileUrl);
              instance = mod.default ? new mod.default() : mod;
            }
            const tools = [];
            if (instance?.getTools) {
              try {
                const tList = instance.getTools();
                if (Array.isArray(tList)) {
                  for (const t of tList) {
                    tools.push({ name: t.name, description: t.description || '' });
                  }
                }
              } catch (e) {}
            }
            this.plugins.set(manifest.id || entry.name, {
              id: manifest.id || entry.name,
              name: manifest.name || entry.name,
              version: manifest.version || '1.0.0',
              description: manifest.description || '',
              enabled: manifest.enabled !== false,
              tools,
              dir: pDir,
              manifest,
              instance
            });
          } catch(e) {
            console.error(`Failed to load plugin ${entry.name}:`, e.message);
          }
        }
      }
    }
  }

  listPlugins() {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      enabled: p.enabled,
      tools: p.tools || []
    }));
  }

  async togglePlugin(id, enabled) {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`Plugin ${id} not found`);
    p.enabled = enabled;
    p.manifest.enabled = enabled;
    fs.writeFileSync(path.join(p.dir, 'manifest.json'), JSON.stringify(p.manifest, null, 2), 'utf-8');
    if (enabled) {
      const mainFile = path.join(p.dir, p.manifest.main || 'index.js');
      if (fs.existsSync(mainFile)) {
        const fileUrl = `${pathToFileURL(mainFile).href}?t=${Date.now()}`;
        const mod = await import(fileUrl);
        p.instance = mod.default ? new mod.default() : mod;
        const tools = [];
        if (p.instance?.getTools) {
          try {
            const tList = p.instance.getTools();
            if (Array.isArray(tList)) {
              for (const t of tList) {
                tools.push({ name: t.name, description: t.description || '' });
              }
            }
          } catch (e) {}
        }
        p.tools = tools;
      }
    } else {
      p.instance = null;
      p.tools = [];
    }
    return { success: true, id, enabled, tools: p.tools };
  }

  async uninstallPlugin(id) {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`Plugin ${id} not found`);
    fs.rmSync(p.dir, { recursive: true, force: true });
    this.plugins.delete(id);
    return { success: true, id };
  }

  // Get tools contributed by active plugins
  getContributedTools() {
    const tools = [];
    for (const p of this.plugins.values()) {
      if (p.enabled && p.instance?.getTools) {
        try {
          const tList = p.instance.getTools();
          if (Array.isArray(tList)) tools.push(...tList);
        } catch(e) {}
      }
    }
    return tools;
  }
}
