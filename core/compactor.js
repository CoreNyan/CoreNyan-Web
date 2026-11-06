import fs from 'fs';
import path from 'path';

export class ContextCompactor {
  constructor(llmClient, options = {}) {
    this.llmClient = llmClient;
    // Threshold in estimated characters / tokens
    this.charThreshold = options.charThreshold || 30000; // ~7k-8k tokens
    this.keepRecentTurns = options.keepRecentTurns || 6;
  }

  estimateSessionLength(messages) {
    let totalChars = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') totalChars += m.content.length;
      if (m.args) totalChars += JSON.stringify(m.args).length;
      if (m.result) totalChars += (typeof m.result === 'string' ? m.result.length : JSON.stringify(m.result).length);
    }
    return totalChars;
  }

  // Find a balanced boundary that doesn't split a tool_call and its tool_result
  findSafeSplitIndex(messages, targetIndex) {
    let idx = Math.min(targetIndex, messages.length);
    while (idx > 0) {
      const msg = messages[idx - 1];
      // If the message is a tool_call, its result might be at idx, not safe to cut here
      if (msg.role === 'tool_call') {
        idx--;
        continue;
      }
      break;
    }
    return idx;
  }

  async compactIfNeeded(session, signal) {
    const messages = session.messages || [];
    if (messages.length < 12) return false;

    const totalChars = this.estimateSessionLength(messages);
    if (totalChars < this.charThreshold) return false;

    return await this.compactSession(session, signal);
  }

  async compactSession(session, signal) {
    const messages = session.messages || [];
    if (messages.length < 6) return false;

    // Split: older part to summarize, recent part to retain
    const rawCut = Math.max(2, messages.length - this.keepRecentTurns);
    const splitIndex = this.findSafeSplitIndex(messages, rawCut);
    if (splitIndex <= 1) return false;

    const spanToSummarize = messages.slice(0, splitIndex);
    const retainedSpan = messages.slice(splitIndex);

    // Prepare transcript text for summary
    const safeText = (value, max = 500) => {
      if (value === undefined || value === null) return '';
      if (typeof value === 'string') return value.slice(0, max);
      try { return JSON.stringify(value).slice(0, max); } catch { return String(value).slice(0, max); }
    };
    const transcript = spanToSummarize.map(m => {
      if (!m || typeof m !== 'object') return '';
      if (m.role === 'user') return `User: ${safeText(m.content, 4000)}`;
      if (m.role === 'assistant') return `Assistant: ${safeText(m.content, 4000)}`;
      if (m.role === 'tool_call') return `Tool Call [${safeText(m.name, 200)}]: ${safeText(m.args, 1000)}`;
      if (m.role === 'tool_result' || m.role === 'tool_execution') return `Tool Result [${safeText(m.name, 200)}]: ${safeText(m.result ?? m.message, 500)}`;
      if (m.role === 'compaction_summary') return `Previous Summary: ${safeText(m.content, 4000)}`;
      return '';
    }).filter(Boolean).join('\n\n');

    const prompt = `请对以下历史对话进行精确的结构化上下文压缩总结。
保留核心事实、用户关键诉求、系统关键环境/状态事实、已经达成的技术结论、已执行工具的重要结果与未完结的待办事项。
语言简练客观，剔除多余寒暄。

【待压缩历史记录】
${transcript}

【输出要求】
直接输出总结内容，不要包含任何前导客套话。`;

    try {
      const resp = await this.llmClient.chatCompletion({
        messages: [
          { role: 'system', content: '你是一个专业的对话上下文压缩与提炼引擎。' },
          { role: 'user', content: prompt }
        ],
        signal
      });

      const summary = typeof resp.content === 'string' ? resp.content.trim() : '';
      if (!summary) return false;

      // Construct new messages array with compaction checkpoint
      const checkpoint = {
        role: 'compaction_summary',
        content: `【历史会话上下文压缩摘要 (Compaction Checkpoint)】\n${summary}`,
        time: Date.now(),
        compressedCount: spanToSummarize.length
      };

      session.messages = [checkpoint, ...retainedSpan];
      return true;
    } catch(e) {
      console.error('Compaction failed:', e.message);
      return false;
    }
  }
}
