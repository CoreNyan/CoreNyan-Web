import fs from 'fs';
import path from 'path';

// Infer user-friendly purpose from tool name and arguments (like DSH presentation layer)
export function inferToolPurpose(toolName, args) {
  if (!args) return `执行 ${toolName}`;
  switch (toolName) {
    case 'pwsh':
      return args.description || (args.command ? `执行终端指令: ${args.command.slice(0, 45)}...` : '执行 PowerShell 指令');
    case 'read_file':
      return args.path ? `读取文件: ${path.basename(args.path)}` : '读取系统文件';
    case 'write_file':
      return args.path ? `写入文件: ${path.basename(args.path)}` : '保存文件内容';
    case 'edit_file':
      return args.path ? `编辑文件: ${path.basename(args.path)}` : '修改代码/文件';
    case 'glob':
      return args.pattern ? `查找匹配文件: ${args.pattern}` : '扫描工作区文件';
    case 'grep':
      return args.pattern ? `全文检索代码: ${args.pattern}` : '正则检索代码';
    case 'memory_recall':
      return args.query ? `检索长期记忆: ${args.query}` : '查询记忆核心';
    case 'memory_save':
      return args.title ? `沉淀记忆知识卡: ${args.title}` : '保存知识卡';
    case 'skill':
      return args.name ? `装载技能规程: ${args.name}` : '加载规程手册';
    case 'web_fetch':
      return args.url ? `抓取网页内容: ${args.url.slice(0, 35)}...` : '网络抓取';
    case 'plugin_manage':
      return `管理插件: ${args.action || '操作'}`;
    default:
      return `执行工具: ${toolName}`;
  }
}

export class Agent {
  constructor({ llmClient, personaConfig, memoryService, skillService, pluginManager, tools, sessionsDir, compactor }) {
    this.llmClient = llmClient;
    this.personaConfig = personaConfig;
    this.memoryService = memoryService;
    this.skillService = skillService;
    this.pluginManager = pluginManager;
    this.builtinTools = tools;
    this.sessionsDir = sessionsDir;
    this.compactor = compactor;

    // Interrupt/Steer & Follow-up queue (DSH-compatible)
    this.steerQueue = new Map(); // sessionId -> Array<{ message, images }>
    this.turnQueue = new Map();  // sessionId -> Array<{ message, images, provider, model, thinkingEffort }>
    this.activeTurnControllers = new Map(); // sessionId -> AbortController
  }

  getAllTools() {
    const pluginTools = this.pluginManager.getContributedTools();
    const all = [...this.builtinTools, ...pluginTools];
    return all.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      },
      _execute: t.execute
    }));
  }

  buildSystemPrompt(presetOverride) {
    const p = presetOverride || this.personaConfig;
    const skills = this.skillService.getCatalog();
    const skillsList = skills.map(s => `- \`${s.name}\`: ${s.description}`).join('\n');

    return `你是${p.name || '小可'}（${p.fullName || 'CoreNyan'}）。
${p.stance || ''}

【性格与背景】
${p.character || ''}

【形象与工作规范】
${p.appearance || ''}

【语气要求】
${p.tone || ''}

【工作契约】
${(p.contracts || []).map(c => `- ${c}`).join('\n')}

【可用技能库 (Skills)】
通过 \`skill\` 工具按需加载具体规程：
${skillsList || '(暂无)'}

【记忆系统（关键行为准则）】
1. 记忆先行：在开始执行任务前、排查故障前或需要项目背景/历史决策/服务器架构规程时，**必须第一时间主动调用 \`memory_recall\` 检索记忆核心**。
2. 严禁盲目猜测：不要凭空假设服务器目录、端口或插件配置，先调取记忆，再结合实际文件与命令推进，避免多走弯路导致流程拉长。
3. 沉淀积累：任务顺利完成或产出重要配置/运维决策时，调用 \`memory_save\` 将高价值成果沉淀为知识卡。

【电脑操作与办公能力】
你可以通过内置工具自由读取系统文件、编辑代码、运行 PowerShell 脚本进行服务器部署与日常自动化操作。保持严谨，动作清晰，结论先行。`;
  }

  loadSession(sessionId) {
    const safeId = String(sessionId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeId || safeId !== String(sessionId)) return {
      id: sessionId,
      title: '新会话',
      groupId: 'default',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    const sPath = path.join(this.sessionsDir, `${safeId}.json`);
    if (fs.existsSync(sPath)) {
      try {
        return JSON.parse(fs.readFileSync(sPath, 'utf-8'));
      } catch (e) {}
    }
    return {
      id: sessionId,
      title: '新会话',
      groupId: 'default',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
  }

  saveSession(session) {
    session.updatedAt = Date.now();
    const sessionsRoot = path.resolve(this.sessionsDir);
    const safeId = String(session.id || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeId || safeId !== String(session.id)) throw new Error('Invalid session id');
    const sPath = path.join(sessionsRoot, `${safeId}.json`);
    const tempPath = `${sPath}.tmp-${process.pid}-${Date.now()}`;
    fs.mkdirSync(sessionsRoot, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(session, null, 2), 'utf-8');
    fs.renameSync(tempPath, sPath);

    // Update index.json
    const indexPath = path.join(sessionsRoot, 'index.json');
    let list = [];
    if (fs.existsSync(indexPath)) {
      try {
        list = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      } catch (e) {}
    }
    const idx = list.findIndex(item => item.id === session.id);
    const existing = idx >= 0 ? list[idx] : {};
    const chatMsgCount = (session.messages || []).filter(m => m.role === 'user' || m.role === 'assistant').length;
    const meta = {
      id: session.id,
      title: session.title || '新会话',
      groupId: session.groupId || existing.groupId || 'default',
      createdAt: session.createdAt || Date.now(),
      updatedAt: session.updatedAt,
      messageCount: chatMsgCount,
      pinned: existing.pinned || false,
      archived: existing.archived || false
    };
    if (idx >= 0) {
      list[idx] = meta;
    } else {
      list.unshift(meta);
    }
    const indexTemp = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(indexTemp, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(indexTemp, indexPath);
  }

  async runTurn({ sessionId, userPrompt, images, author, avatar, provider, model, thinkingEffort, preset, onStream, maxSteps = 15, signal }) {
    const session = this.loadSession(sessionId);
    const taskTimeoutMs = Number(process.env.FREECORE_MIND_TASK_TIMEOUT_MS || 10 * 60 * 1000);
    const externalSignal = signal;
    signal = AbortSignal.any([externalSignal || new AbortController().signal, AbortSignal.timeout(taskTimeoutMs)]);
    const abortError = (reason = '任务已中断') => {
      const error = new Error(reason);
      error.code = reason.includes('超时') ? 'TASK_TIMEOUT' : 'TASK_ABORTED';
      error.kind = error.code === 'TASK_TIMEOUT' ? 'timeout' : 'aborted';
      return error;
    };
    if (signal?.aborted) throw abortError('任务已中断');
    const onAbort = () => {};
    signal?.addEventListener('abort', onAbort, { once: true });
    try {

    // Append user message
    if (userPrompt || (images && images.length > 0)) {
      const userMsg = {
        role: 'user',
        content: userPrompt || '',
        images: images || [],
        author: author || 'LynnH_Ma',
        avatar: avatar || (author ? `https://mc-heads.net/avatar/${encodeURIComponent(author)}/64` : undefined),
        time: Date.now()
      };
      session.messages.push(userMsg);
      if (session.messages.filter(m => m.role === 'user').length === 1 && userPrompt) {
        session.title = userPrompt.slice(0, 30);
      }
      this.saveSession(session);
    }

    // Auto Compaction Check before running
    if (this.compactor) {
      const compacted = await this.compactor.compactIfNeeded(session, signal);
      if (compacted) {
        onStream?.({
          type: 'compaction',
          message: '上下文已自动执行压缩摘要，历史关键信息已沉淀为 Checkpoint。'
        });
        this.saveSession(session);
      }
    }

    const systemPrompt = this.buildSystemPrompt(preset);
    const tools = this.getAllTools();
    const toolExecMap = new Map(tools.map(t => [t.function.name, t._execute]));

    let step = 0;
    let completed = false;
    while (step < maxSteps) {
      step++;
      if (signal?.aborted) throw abortError('任务已中断');

      // Check if there is an interrupt/steer command queued for this session
      if (this.steerQueue && this.steerQueue.has(sessionId) && this.steerQueue.get(sessionId).length > 0) {
        const steerItem = this.steerQueue.get(sessionId).shift();
        const steerMsg = {
          role: 'user',
          content: steerItem.message,
          images: steerItem.images || [],
          time: Date.now(),
          steer: true
        };
        session.messages.push(steerMsg);
        this.saveSession(session);
        onStream?.({
          type: 'steer_injected',
          message: steerMsg
        });
      }

      // Construct LLM message array
      const llmMessages = [
        { role: 'system', content: systemPrompt }
      ];

      for (let i = 0; i < session.messages.length; i++) {
        const m = session.messages[i];
        if (!m) continue;
        if (m.role === 'user') {
          const trimmed = typeof m.content === 'string' ? m.content.trim() : '';
          if (
            trimmed.startsWith('Current runtime context. This snapshot supersedes') ||
            trimmed.startsWith('<system-reminder>')
          ) {
            continue;
          }
          if (m.images && m.images.length > 0) {
            const parts = [{ type: 'text', text: m.content || '' }];
            for (const img of m.images) {
              let finalImgUrl = img;
              // If relative attachment path, convert to absolute base64 data URL so upstream LLM can inspect
              if (typeof img === 'string' && img.startsWith('/attachments/')) {
                const localAttachPath = path.join(path.dirname(this.sessionsDir), 'attachments', path.basename(img));
                if (fs.existsSync(localAttachPath)) {
                  const ext = path.extname(localAttachPath).slice(1) || 'png';
                  const b64 = fs.readFileSync(localAttachPath).toString('base64');
                  finalImgUrl = `data:image/${ext};base64,${b64}`;
                }
              }
              parts.push({
                type: 'image_url',
                image_url: { url: finalImgUrl }
              });
            }
            llmMessages.push({ role: 'user', content: parts });
          } else {
            llmMessages.push({ role: 'user', content: m.content });
          }
        } else if (m.role === 'assistant') {
          // Do not send historical empty assistant bubbles back to the provider.
          // They are incomplete UI artifacts and can cause an empty continuation.
          const assistantContent = typeof m.content === 'string' ? m.content.trim() : '';
          if (assistantContent) {
            llmMessages.push({ role: 'assistant', content: m.content });
          }
        } else if (m.role === 'compaction_summary') {
          llmMessages.push({ role: 'user', content: m.content });
        } else if (m.role === 'tool_execution') {
          llmMessages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: m.call_id || `call_${m.time}`,
              type: 'function',
              function: {
                name: m.name,
                arguments: typeof m.args === 'string' ? m.args : JSON.stringify(m.args || {})
              }
            }]
          });
          const resultContent = typeof m.result === 'string' ? m.result : JSON.stringify(m.result);
          llmMessages.push({
            role: 'tool',
            tool_call_id: m.call_id || `call_${m.time}`,
            content: resultContent || '(completed)'
          });
        } else if (m.role === 'tool_call') {
          const next = session.messages[i + 1];
          const hasResult = next && next.role === 'tool_result';
          const callId = m.call_id || `call_${m.time || i}`;
          llmMessages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: callId,
              type: 'function',
              function: {
                name: m.name || 'tool',
                arguments: typeof m.args === 'string' ? m.args : JSON.stringify(m.args || {})
              }
            }]
          });
          const rawRes = hasResult ? next.result : '(completed)';
          const resultContent = typeof rawRes === 'string' ? rawRes : JSON.stringify(rawRes ?? '(completed)');
          llmMessages.push({
            role: 'tool',
            tool_call_id: callId,
            content: resultContent || '(completed)'
          });
          if (hasResult) i++;
        }
      }

      onStream?.({ type: 'step_start', step });

      let currentResponse = null;
      try {
        currentResponse = await this.llmClient.chatCompletion({
          messages: llmMessages,
          tools: tools.map(t => ({ type: t.type, function: t.function })),
          provider,
          model,
          thinkingEffort,
          onDelta: (text) => {
            onStream?.({ type: 'delta', content: text });
          },
          onReasoningDelta: (reasoning) => {
            onStream?.({ type: 'reasoning_delta', content: reasoning });
          },
          signal
        });
      } catch (err) {
        onStream?.({ type: 'error', error: err.message });
        throw err;
      }

      if (currentResponse.content) {
        const assistantMsg = {
          role: 'assistant',
          content: currentResponse.content,
          model: currentResponse.model,
          usage: currentResponse.usage,
          contextWindowMessages: llmMessages.length,
          time: Date.now()
        };
        session.messages.push(assistantMsg);
        this.saveSession(session);
        onStream?.({
          type: 'assistant_meta',
          model: currentResponse.model,
          usage: currentResponse.usage,
          contextWindowMessages: llmMessages.length
        });
      }

      if (!currentResponse.toolCalls || currentResponse.toolCalls.length === 0) {
        if (!String(currentResponse.content || '').trim()) {
          // If empty, attempt one automatic retry with a direct poke before failing
          console.warn(`[Agent] Empty response encountered at step ${step}. Retrying...`);
          llmMessages.push({ role: 'user', content: '请继续给出你的分析或结论。' });
          try {
            currentResponse = await this.llmClient.chatCompletion({
              messages: llmMessages,
              tools: tools.map(t => ({ type: t.type, function: t.function })),
              provider,
              model,
              thinkingEffort,
              onDelta: (text) => {
                onStream?.({ type: 'delta', content: text });
              },
              onReasoningDelta: (reasoning) => {
                onStream?.({ type: 'reasoning_delta', content: reasoning });
              },
              signal
            });
            if (currentResponse.content) {
              const retryAssistantMsg = {
                role: 'assistant',
                content: currentResponse.content,
                model: currentResponse.model,
                usage: currentResponse.usage,
                contextWindowMessages: llmMessages.length,
                time: Date.now()
              };
              session.messages.push(retryAssistantMsg);
              this.saveSession(session);
            }
          } catch (retryErr) {
            console.error('[Agent] Empty response retry failed:', retryErr);
          }
        }
        if (!String(currentResponse.content || '').trim() && (!currentResponse.toolCalls || currentResponse.toolCalls.length === 0)) {
          throw Object.assign(new Error('EMPTY_RESPONSE: 模型返回了空消息'), { code: 'EMPTY_RESPONSE' });
        }
        if (!currentResponse.toolCalls || currentResponse.toolCalls.length === 0) {
          completed = true;
          onStream?.({ type: 'turn_end' });
          break;
        }
      }

      // Execute tool calls
      for (const tc of currentResponse.toolCalls) {
        const fnName = tc.function.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(tc.function.arguments || '{}');
        } catch (e) {
          fnArgs = {};
        }

        const callId = tc.id || `call_${Date.now()}`;
        const purpose = inferToolPurpose(fnName, fnArgs);

        onStream?.({
          type: 'tool_start',
          callId,
          name: fnName,
          purpose,
          args: fnArgs
        });

        const executor = toolExecMap.get(fnName);
        let rawResult = '';
        let fileDiff = null;
        let durationMs = 0;
        let status = 'success';
        const startTime = Date.now();
        if (executor) {
          try {
            const out = await executor(fnArgs);
            if (out && typeof out === 'object' && out.fileDiff) {
              rawResult = out.message || 'Operation successful';
              fileDiff = out.fileDiff;
            } else {
              rawResult = out;
            }
          } catch (e) {
            status = 'error';
            rawResult = `Error: ${e.message}`;
          }
        } else {
          status = 'error';
          rawResult = `Tool ${fnName} not found.`;
        }
        durationMs = Date.now() - startTime;

        const execRecord = {
          role: 'tool_execution',
          call_id: callId,
          name: fnName,
          purpose,
          args: fnArgs,
          result: rawResult,
          fileDiff,
          durationMs,
          status,
          time: Date.now()
        };

        onStream?.({
          type: 'tool_finish',
          ...execRecord
        });

        session.messages.push(execRecord);
        this.saveSession(session);
      }
    }

    if (!completed) {
      onStream?.({ type: 'error', code: 'MAX_STEPS', error: `任务达到最大推理步数（${maxSteps}），已停止。` });
    }
    this.saveSession(session);
    return session;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
