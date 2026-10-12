import type { createSettingsStore } from '@main/settings/store';
import { LOCAL_MODEL, ONLINE_MODELS, type ModelTarget } from '@shared/contracts/models';
import type { createLocalModelRuntime } from './local-model';

export function createModelTargetResolver(input: {
  settings: ReturnType<typeof createSettingsStore>;
  localModel: ReturnType<typeof createLocalModelRuntime>;
}) {
  return async ({ signal }: { runId: string; signal: AbortSignal }): Promise<ModelTarget> => {
    const result = await input.settings.load();
    if (!result.ok) throw new Error(result.message);
    signal.throwIfAborted();
    const selection = result.settings.model;
    if (selection.mode === 'offline') {
      const handle = await input.localModel.ensure(signal);
      signal.throwIfAborted();
      return { provider: 'Qwen-3.5-4B-local', modelId: LOCAL_MODEL.id,
        baseUrl: handle.origin + '/v1', apiKey: handle.token };
    }
    const model = ONLINE_MODELS.find(item => item.id === selection.onlineModel);
    if (!model) throw new Error('在线模型未接入。');
    if (!result.settings.ai.credentialId)
      throw new Error('请先配置在线模型 API Key，或切换为离线模式。');
    const apiKey = await input.settings.getKey(result.settings.ai.credentialId);
    signal.throwIfAborted();
    return { provider: model.provider, modelId: model.id, apiKey };
  };
}
