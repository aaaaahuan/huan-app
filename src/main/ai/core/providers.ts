import { request } from 'node:http';
import { Readable } from 'node:stream';
import type { JsonValue } from '@earendil-works/pi-agent-core';
import type {
  Api, AssistantMessageEventStream, Model, Models, ProviderStreams,
  SimpleStreamOptions, StreamOptions, TranscriptContext
} from '@earendil-works/pi-ai';
import type { ModelTarget } from '@shared/contracts/models';
import type { ExecutionFailure, ModelIdentity } from '@shared/contracts/ai-execution';
import type { RunRecorder } from './records';

export interface HarnessModels {
  models: Models;
  model: Model<Api>;
  failure(): ExecutionFailure | undefined;
}

function requestBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_PAYLOAD');
  return value as Record<string, unknown>;
}

const RECORDED_FIELDS = [
  'model', 'messages', 'tools', 'tool_choice', 'stream', 'stream_options',
  'temperature', 'max_tokens', 'max_completion_tokens', 'thinking',
  'parallel_tool_calls', 'cache_prompt', 'chat_template_kwargs'
] as const;

function safeRequestBody(body: Record<string, unknown>): JsonValue {
  const selected: Record<string, unknown> = {};
  for (const name of RECORDED_FIELDS) {
    if (body[name] !== undefined) selected[name] = body[name];
  }
  return JSON.parse(JSON.stringify(selected)) as JsonValue;
}

function preparePayload(
  payload: unknown, target: ModelTarget, maxOutputTokens: number | undefined,
  temperature: number | undefined
): Record<string, unknown> {
  const body = requestBody(payload);
  if (maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0))
    throw new Error('INVALID_OUTPUT_LIMIT');
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2))
    throw new Error('INVALID_TEMPERATURE');
  if (target.provider === 'Qwen-3.5-4B-local') {
    return {
      ...body, model: target.modelId, cache_prompt: false, parallel_tool_calls: false,
      max_tokens: -1, chat_template_kwargs: { enable_thinking: false },
      ...(temperature === undefined ? {} : { temperature })
    };
  }
  return {
    ...body, model: target.modelId, thinking: { type: 'disabled' },
    ...(maxOutputTokens === undefined ? {} : { max_tokens: maxOutputTokens }),
    ...(temperature === undefined ? {} : { temperature })
  };
}

function localResponse(url: string, init: RequestInit | undefined, signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (typeof init?.body !== 'string') {
      reject(new Error('INVALID_LOCAL_BODY'));
      return;
    }
    const outgoing = request(url, {
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers)),
      signal,
      agent: false
    }, incoming => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined)
          headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
        status: incoming.statusCode ?? 500,
        headers
      }));
    });
    outgoing.once('error', reject);
    outgoing.end(init.body);
  });
}

function localModel(target: Extract<ModelTarget, { provider: 'Qwen-3.5-4B-local' }>): Model<'openai-completions'> {
  const url = new URL(target.baseUrl);
  if (
    url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.pathname !== '/v1' || url.username || url.password || url.search || url.hash
  ) throw new Error('LOCAL_ENDPOINT_REJECTED');
  return {
    id: target.modelId,
    name: target.modelId,
    provider: target.provider,
    api: 'openai-completions',
    baseUrl: target.baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 262144,
    compat: {
      supportsStore: false, supportsDeveloperRole: false,
      supportsReasoningEffort: false, supportsStrictMode: false,
      maxTokensField: 'max_tokens'
    }
  };
}

function failureFromError(error: unknown): ExecutionFailure {
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return { kind: 'timeout', code: 'TIMEOUT' };
  if (error instanceof Error && error.name === 'AbortError')
    return { kind: 'unknown', code: 'ABORTED' };
  return { kind: 'network', code: 'NETWORK_ERROR' };
}

export async function createHarnessModels(
  target: ModelTarget,
  options: { recorder: RunRecorder; maxOutputTokens?: number; temperature?: number }
): Promise<HarnessModels> {
  const { createModels, createProvider } = await import('@earendil-works/pi-ai');
  const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
  let selectedModel: Model<'openai-completions'> | undefined;
  if (target.provider === 'deepseek') {
    const { deepseekProvider } = await import('@earendil-works/pi-ai/providers/deepseek');
    selectedModel = deepseekProvider().getModels().find(item => item.id === target.modelId);
  } else {
    selectedModel = localModel(target);
  }
  if (!selectedModel || selectedModel.api !== 'openai-completions')
    throw new Error('MODEL_UNAVAILABLE');

  const endpoint = selectedModel.baseUrl.replace(/\/$/, '') + '/chat/completions';
  let lastFailure: ExecutionFailure | undefined;
  const sdk = openAICompletionsApi();
  const identity: ModelIdentity = {
    mode: target.provider === 'Qwen-3.5-4B-local' ? 'offline' : 'online',
    provider: target.provider, modelId: target.modelId
  };

  function withFrozenOptions<T extends StreamOptions | SimpleStreamOptions>(streamOptions?: T): T {
    const frozenSignal = streamOptions?.signal;
    return {
      ...streamOptions,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url !== endpoint) throw new Error('ENDPOINT_REJECTED');
        try {
          const response = target.provider === 'Qwen-3.5-4B-local'
            ? await localResponse(url, init, frozenSignal)
            : await fetch(input, { ...init, redirect: 'error' });
          if (!response.ok)
            lastFailure = { kind: 'http', code: 'HTTP_ERROR', httpStatus: response.status };
          return response;
        } catch (error) {
          lastFailure = failureFromError(error);
          throw error;
        }
      },
      onPayload: async (payload: unknown, requestModel: Model<Api>) => {
        const fromHarness = await streamOptions?.onPayload?.(payload, requestModel) ?? payload;
        const finalBody = preparePayload(
          fromHarness, target, options.maxOutputTokens, options.temperature
        );
        await options.recorder.recordModelRequestPrepared({
          model: identity,
          body: safeRequestBody(finalBody)
        });
        return finalBody;
      }
    } as T;
  }

  const api: ProviderStreams = {
    stream(model: Model<Api>, context: TranscriptContext, streamOptions?: StreamOptions): AssistantMessageEventStream {
      return sdk.stream(model, context, withFrozenOptions(streamOptions));
    },
    streamSimple(model: Model<Api>, context: TranscriptContext, streamOptions?: SimpleStreamOptions): AssistantMessageEventStream {
      return sdk.streamSimple(model, context, withFrozenOptions(streamOptions));
    }
  };
  const models = createModels();
  models.setProvider(createProvider({
    id: target.provider,
    name: target.provider,
    baseUrl: selectedModel.baseUrl,
    models: [selectedModel],
    auth: {
      apiKey: {
        name: target.provider === 'deepseek' ? 'DeepSeek API key' : 'Local runtime',
        resolve: async () => ({ auth: { apiKey: target.apiKey } })
      }
    },
    api
  }));
  const found = models.getModel(target.provider, target.modelId);
  if (!found) throw new Error('MODEL_UNAVAILABLE');
  return { models, model: found, failure: () => lastFailure };
}
