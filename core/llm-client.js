// Lightweight OpenAI-compatible LLM Client for FreeCore-Mind
export class LlmClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gpt-4o';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 4096;
  }

  updateConfig(config = {}) {
    if (config.baseURL) this.baseURL = config.baseURL;
    if (config.apiKey) this.apiKey = config.apiKey;
    if (config.model) this.model = config.model;
    if (config.temperature !== undefined) this.temperature = config.temperature;
    if (config.maxTokens !== undefined) this.maxTokens = config.maxTokens;
  }

  async chatCompletion({ messages, tools, onDelta, onReasoningDelta, provider, model, thinkingEffort, signal }) {
    if (typeof fetch !== 'function') throw new Error('Node.js 18 or later is required (global fetch is unavailable)');
    const effectiveApiKey = provider?.apiKey || this.apiKey;
    if (!effectiveApiKey) throw new Error('LLM API key is not configured');
    const requestTimeoutMs = Number(process.env.FREECORE_MIND_LLM_TIMEOUT_MS || 120000);
    const requestSignal = signal || AbortSignal.timeout(requestTimeoutMs);
    const baseURL = (provider?.baseURL || this.baseURL).replace(/\/+$/, '');
    const apiKey = provider?.apiKey || this.apiKey;
    const modelToUse = model || provider?.models?.[0]?.id || this.model;

    const payload = {
      model: modelToUse,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
      stream_options: { include_usage: true }
    };

    // If Gemini model, omit temperature if unsupported or keep reasonable
    if (modelToUse.includes('gemini-3')) {
      delete payload.temperature;
    }

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    if (thinkingEffort && thinkingEffort !== 'off') {
      payload.reasoning_effort = thinkingEffort;
    }

    // Resilient Retry Loop for 429, 503, 502, 504, 500, Network drops
    const maxRetries = 3;
    let attempt = 0;
    let response = null;

    while (attempt <= maxRetries) {
      attempt++;
      try {
        response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload),
          signal: requestSignal
        });

        // If rate-limited or transient upstream server error, retry with exponential backoff
        if (!response.ok && (response.status === 429 || response.status === 503 || response.status === 502 || response.status === 504 || response.status === 500)) {
          const errText = await response.text();
          if (attempt <= maxRetries) {
            const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000) + Math.random() * 500;
            console.warn(`[LlmClient] HTTP ${response.status} encountered: ${errText.slice(0, 100)}. Retrying attempt ${attempt}/${maxRetries} in ${Math.round(backoffMs)}ms...`);
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          } else {
            throw new Error(`LLM Error ${response.status} (after ${maxRetries} retries): ${errText}`);
          }
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`LLM Error ${response.status}: ${errText}`);
        }

        // Successfully received valid stream response
        break;
      } catch (networkErr) {
        if (requestSignal?.aborted) throw networkErr;
        if (attempt <= maxRetries && !networkErr.message.includes('LLM Error')) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000) + Math.random() * 500;
          console.warn(`[LlmClient] Network error: ${networkErr.message}. Retrying attempt ${attempt}/${maxRetries} in ${Math.round(backoffMs)}ms...`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        throw networkErr;
      }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';
    let rawReasoning = '';
    let toolCalls = [];
    let rawUsage = null;
    let receivedAnyPayload = false;

    while (true) {
      if (requestSignal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            receivedAnyPayload = true;
            if (data.error) throw new Error(data.error.message || 'Upstream LLM returned an error');
            if (data.usage) {
              rawUsage = data.usage;
            }
            const choice = data.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (delta) {
              const reasoningText = delta.reasoning_content || delta.reasoning || delta.thought || '';
              if (reasoningText) {
                rawReasoning += reasoningText;
                if (onReasoningDelta) onReasoningDelta(reasoningText);
              }
              if (delta.content) {
                fullContent += delta.content;
                if (onDelta) onDelta(delta.content);
              }
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCalls[idx]) {
                    toolCalls[idx] = {
                      id: tc.id || `call_${Date.now()}_${idx}`,
                      type: 'function',
                      function: { name: '', arguments: '' }
                    };
                  }
                  if (tc.id) toolCalls[idx].id = tc.id;
                  if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                  if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
                }
              }
            }
          } catch (e) {
            if (e instanceof Error && e.message) throw e;
            throw new Error('Invalid upstream SSE payload');
          }
        }
      }
    }

    // Some OpenAI-compatible gateways omit the final newline. Parse the tail.
    const tail = buffer.trim();
    if (tail.startsWith('data: ') && tail !== 'data: [DONE]') {
      try {
        const data = JSON.parse(tail.slice(6));
        if (data.error) throw new Error(data.error.message || 'Upstream LLM returned an error');
        if (data.usage) rawUsage = data.usage;
        const delta = data.choices?.[0]?.delta;
        if (delta?.content) { fullContent += delta.content; onDelta?.(delta.content); }
        const tailReasoning = delta?.reasoning_content || delta?.reasoning || delta?.thought;
        if (tailReasoning) { rawReasoning += tailReasoning; onReasoningDelta?.(tailReasoning); }
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }

    if (!fullContent && toolCalls.length === 0) {
      if (rawReasoning && !requestSignal?.aborted) {
        console.warn('[LlmClient] Model produced reasoning but no final content/tools. Using reasoning summary as fallback.');
        fullContent = rawReasoning;
      } else {
        throw new Error('EMPTY_RESPONSE: upstream returned no usable content');
      }
    }

    // Precise DSH-aligned Token Usage Struct
    let usage = null;
    if (rawUsage) {
      const promptTokens = rawUsage.prompt_tokens || 0;
      const completionTokens = rawUsage.completion_tokens || 0;
      const totalTokens = rawUsage.total_tokens || (promptTokens + completionTokens);

      // DeepSeek / OpenAI / Anthropic cache read detection
      const cacheRead = rawUsage.prompt_tokens_details?.cached_tokens ??
                        rawUsage.prompt_cache_hit_tokens ??
                        rawUsage.cached_tokens ??
                        rawUsage.cache_read_input_tokens ?? 0;

      const uncachedInput = Math.max(0, promptTokens - cacheRead);
      const reasoningTokens = rawUsage.completion_tokens_details?.reasoning_tokens ?? 0;

      usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cache_read: cacheRead,
        uncached_input: uncachedInput,
        reasoning_tokens: reasoningTokens,
        estimated: false
      };
    } else {
      // Fallback estimate
      const promptChars = JSON.stringify(messages).length;
      const completionChars = fullContent.length;
      const promptTokens = Math.round(promptChars / 3.8);
      const completionTokens = Math.round(completionChars / 3.8);
      usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        cache_read: 0,
        uncached_input: promptTokens,
        reasoning_tokens: 0,
        estimated: true
      };
    }

    return {
      content: fullContent,
      toolCalls: toolCalls.filter(Boolean),
      usage,
      model: modelToUse
    };
  }
}
