import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

// Generate line-by-line unified diff for file audits
export function generateUnifiedDiff(filePath, oldContent, newContent) {
  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent ? newContent.split('\n') : [];
  const diff = [];
  
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diff.push({ type: 'normal', line: oldLines[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
      diff.push({ type: 'add', line: newLines[j], newNo: j + 1 });
      j++;
    } else if (i < oldLines.length) {
      diff.push({ type: 'del', line: oldLines[i], oldNo: i + 1 });
      i++;
    }
  }

  const addedCount = diff.filter(d => d.type === 'add').length;
  const deletedCount = diff.filter(d => d.type === 'del').length;

  return {
    path: filePath,
    filename: path.basename(filePath),
    addedCount,
    deletedCount,
    diff
  };
}

export function createBuiltinTools({ memoryService, skillService, pluginManager, workspaceRoot }) {
  const tools = [];

  // 1. pwsh (PowerShell Execution with timeout & non-interactive flags)
  tools.push({
    name: 'pwsh',
    description: 'Execute a PowerShell command in the workspace. Returns output or terminates on timeout.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The PowerShell command to execute.' },
        description: { type: 'string', description: 'Clear, concise description of what this command does.' },
        timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds (default 30000ms).' }
      },
      required: ['command']
    },
    execute: async ({ command, description, timeoutMs = 30000 }) => {
      return new Promise((resolve) => {
        // Enforce NonInteractive and NoProfile to prevent PowerShell from hanging on interactive prompts (e.g. Read-Host, confirmation dialogs)
        const wrappedCmd = `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${command.replace(/"/g, '`"')}"`;
        exec(wrappedCmd, {
          cwd: workspaceRoot,
          maxBuffer: 1024 * 1024 * 8,
          timeout: timeoutMs,
          killSignal: 'SIGTERM',
          windowsHide: true
        }, (err, stdout, stderr) => {
          if (err) {
            if (err.killed) {
              resolve(`[Execution Timed Out after ${timeoutMs}ms]\n${stdout || ''}\n命令执行超时，已安全中断。`);
            } else {
              resolve(`[Exit Code: ${err.code || 1}]\n${stderr || err.message}\n${stdout || ''}`);
            }
          } else {
            resolve(stdout || '(No output)');
          }
        });
      });
    }
  });

  // 2. read_file
  tools.push({
    name: 'read_file',
    description: 'Read the UTF-8 text content of a file.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file.' },
        offset: { type: 'number', description: '1-based line number to start reading from.' },
        limit: { type: 'number', description: 'Maximum number of lines to return.' }
      },
      required: ['file_path']
    },
    execute: async ({ file_path, offset = 1, limit = 2000 }) => {
      try {
        if (!fs.existsSync(file_path)) return `Error: File not found: ${file_path}`;
        const content = fs.readFileSync(file_path, 'utf-8');
        const lines = content.split('\n');
        const start = Math.max(0, offset - 1);
        const end = start + limit;
        const sliced = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
        return `<path>${file_path}</path>\n<content>\n${sliced}\n</content>`;
      } catch(e) {
        return `Error: ${e.message}`;
      }
    }
  });

  // 3. write_file (Supports File Diff Tracking)
  tools.push({
    name: 'write_file',
    description: 'Create or overwrite a file with UTF-8 text content.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file.' },
        content: { type: 'string', description: 'File text content.' }
      },
      required: ['file_path', 'content']
    },
    execute: async ({ file_path, content }) => {
      try {
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        const oldContent = fs.existsSync(file_path) ? fs.readFileSync(file_path, 'utf-8') : '';
        fs.writeFileSync(file_path, content, 'utf-8');

        const diffData = generateUnifiedDiff(file_path, oldContent, content);
        return {
          message: `Successfully wrote ${content.length} characters to ${file_path}`,
          fileDiff: diffData
        };
      } catch(e) {
        return `Error: ${e.message}`;
      }
    }
  });

  // 4. edit_file (Supports File Diff Tracking)
  tools.push({
    name: 'edit_file',
    description: 'Edit a text file by replacing old_string with new_string.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file.' },
        old_string: { type: 'string', description: 'Exact string to be replaced.' },
        new_string: { type: 'string', description: 'Replacement string.' },
        replace_all: { type: 'boolean', description: 'Whether to replace all occurrences.' }
      },
      required: ['file_path', 'old_string', 'new_string']
    },
    execute: async ({ file_path, old_string, new_string, replace_all = false }) => {
      try {
        if (!fs.existsSync(file_path)) return `Error: File not found: ${file_path}`;
        const oldContent = fs.readFileSync(file_path, 'utf-8');
        if (!oldContent.includes(old_string)) return `Error: old_string not found in ${file_path}`;
        let replaced;
        if (replace_all) {
          replaced = oldContent.split(old_string).join(new_string);
        } else {
          const idx = oldContent.indexOf(old_string);
          replaced = oldContent.slice(0, idx) + new_string + oldContent.slice(idx + old_string.length);
        }
        fs.writeFileSync(file_path, replaced, 'utf-8');

        const diffData = generateUnifiedDiff(file_path, oldContent, replaced);
        return {
          message: `Successfully edited ${file_path}`,
          fileDiff: diffData
        };
      } catch(e) {
        return `Error: ${e.message}`;
      }
    }
  });

  // 5. glob
  tools.push({
    name: 'glob',
    description: 'Find files matching a glob pattern.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. *.js, **/*.json).' },
        path: { type: 'string', description: 'Base directory to search.' }
      },
      required: ['pattern']
    },
    execute: async ({ pattern, path: searchPath }) => {
      const base = searchPath || workspaceRoot;
      return new Promise((resolve) => {
        const cmd = `Get-ChildItem -Path "${base}" -Filter "${pattern}" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 100 -ExpandProperty FullName`;
        exec(cmd, { shell: 'powershell.exe' }, (err, stdout) => {
          resolve(stdout || 'No matching files found.');
        });
      });
    }
  });

  // 6. grep
  tools.push({
    name: 'grep',
    description: 'Search for regular expression patterns in files.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern.' },
        path: { type: 'string', description: 'Path to directory or file.' },
        include: { type: 'string', description: 'File extension filter (e.g. *.js).' }
      },
      required: ['pattern']
    },
    execute: async ({ pattern, path: searchPath, include }) => {
      const base = searchPath || workspaceRoot;
      return new Promise((resolve) => {
        const filterArg = include ? `-Include "${include}"` : '';
        const cmd = `Select-String -Path "${base}\\*" ${filterArg} -Pattern "${pattern}" -List -ErrorAction SilentlyContinue | Select-Object -First 100 -Property Path, LineNumber, Line`;
        exec(cmd, { shell: 'powershell.exe' }, (err, stdout) => {
          resolve(stdout || 'No matches found.');
        });
      });
    }
  });

  // 7. memory_recall
  tools.push({
    name: 'memory_recall',
    description: 'Retrieve knowledge cards and decisions from the SQLite memory vault.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords or description to search in memory.' },
        limit: { type: 'number', description: 'Max cards to return.' }
      },
      required: ['query']
    },
    execute: async ({ query, limit = 5 }) => {
      return memoryService.recall(query, limit);
    }
  });

  // 8. memory_save
  tools.push({
    name: 'memory_save',
    description: 'Save a new valuable conclusion into the persistent memory vault.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the knowledge card.' },
        content: { type: 'string', description: 'Markdown body content.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags list.' }
      },
      required: ['title', 'content']
    },
    execute: async ({ title, content, tags = [] }) => {
      return memoryService.save({ title, content, tags });
    }
  });

  // 9. skill
  tools.push({
    name: 'skill',
    description: 'Load full instruction content for a skill in the catalog.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact skill name.' }
      },
      required: ['name']
    },
    execute: async ({ name }) => {
      return skillService.loadSkill(name);
    }
  });

  // 10. web_fetch
  tools.push({
    name: 'web_fetch',
    description: 'Fetch the text content of a URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP/HTTPS URL to fetch.' }
      },
      required: ['url']
    },
    execute: async ({ url }) => {
      try {
        const res = await fetch(url);
        const text = await res.text();
        return text.slice(0, 10000);
      } catch(e) {
        return `Fetch error: ${e.message}`;
      }
    }
  });

  return tools;
}
