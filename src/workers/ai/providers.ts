import type { Model, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai';
import type { ModelTarget } from '@shared/contracts/models';
import { request } from 'node:http';
import { Readable } from 'node:stream';

function localResponse(url: string, init: RequestInit | undefined, signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (typeof init?.body !== 'string') { reject(new Error('INVALID_LOCAL_BODY')); return; }
    // 本地推理只由调用者取消，不继承 fetch 响应头超时或 SDK 的云端等待预算。
    const outgoing = request(url, { method: init.method, headers: Object.fromEntries(new Headers(init.headers)), signal, agent: false }, incoming => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status: incoming.statusCode ?? 500, headers }));
    });
    outgoing.once('error', reject);
    outgoing.end(init.body);
  });
}

// 每轮客户端冻结 endpoint 与凭据；切换模式或 runtime 重启不会改写在途请求。
export async function createModelClient(target: ModelTarget) {
  const { createModels, createProvider } = await import('@earendil-works/pi-ai');
  const models = createModels();
  let model: Model<'openai-completions'>;
  if (target.provider === 'deepseek') {
    const { deepseekProvider } = await import('@earendil-works/pi-ai/providers/deepseek');
    const provider = deepseekProvider();
    models.setProvider(provider);
    const found = provider.getModels().find(item => item.id === target.modelId);
    if (!found || found.api !== 'openai-completions') throw new Error('在线模型未接入。');
    model = found;
  } else {
    const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
    const url = new URL(target.baseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/v1' || url.username || url.password || url.search || url.hash)
      throw new Error('LOCAL_ENDPOINT_REJECTED');
    model = { id: target.modelId, name: target.modelId, provider: 'Qwen-3.5-4B-local', api: 'openai-completions', baseUrl: target.baseUrl,
      reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      // 元数据是模型原生容量，不是当前引擎分配量；超出实际容量由引擎报错。
      contextWindow: 262144, maxTokens: 262144,
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
        supportsStrictMode: false, maxTokensField: 'max_tokens' } };
    models.setProvider(createProvider({ id: 'Qwen-3.5-4B-local', models: [model], api: openAICompletionsApi(),
      auth: { apiKey: { name: '本地 runtime', resolve: async () => ({ auth: {} }) } } }));
  }
  const endpoint = `${model.baseUrl.replace(/\/$/, '')}/chat/completions`;
  return {
    model,
    stream(context: TranscriptContext, options?: SimpleStreamOptions) {
      return models.streamSimple(model, context, {
        ...options, apiKey: target.apiKey, maxRetries: 0, cacheRetention: 'none',
        fetch: (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url !== endpoint) throw new Error('ENDPOINT_REJECTED');
          if (target.provider === 'Qwen-3.5-4B-local') return localResponse(url, init, options?.signal);
          return fetch(input, { ...init, redirect: 'error' });
        },
        onPayload: payload => {
          if (typeof payload !== 'object' || payload === null) throw new Error('INVALID_PAYLOAD');
          return target.provider === 'Qwen-3.5-4B-local'
            ? { ...payload, model: target.modelId, cache_prompt: false, parallel_tool_calls: false,
              max_tokens: -1, chat_template_kwargs: { enable_thinking: false } }
            : { ...payload, model: target.modelId, thinking: { type: 'disabled' } };
        }
      });
    }
  };
}
