import { net } from 'electron';
import { z } from 'zod';
import { LOCAL_MODEL, ONLINE_MODELS, type ModelGroup, type OnlineProvider } from '@shared/contracts/models';
import type { createSettingsStore } from '@main/settings/store';

const responseSchema = z.object({ data: z.array(z.object({ id: z.string() })).max(10000) });
const endpoints = { openai: 'https://api.openai.com/v1/models', deepseek: 'https://api.deepseek.com/models' };

// 只向固定官方端点发送已保存凭据，返回 renderer 的数据不包含 Key 或请求头。
export async function listAvailableModels(settings: ReturnType<typeof createSettingsStore>): Promise<ModelGroup[]> {
  const current = await settings.load();
  if (!current.ok) throw new Error(current.message);
  const groups = await Promise.all((['openai', 'deepseek'] as const).map(async (provider: OnlineProvider): Promise<ModelGroup> => {
    const group: ModelGroup = { id: provider, name: provider === 'openai' ? 'OpenAI' : 'DeepSeek', models: [] };
    const config = provider === 'openai' ? current.settings.openai : current.settings.ai;
    if (!config.credentialId) return { ...group, message: '请先在设置中保存 API Key。' };
    try {
      const key = await settings.getKey(config.credentialId, provider);
      const response = await net.fetch(endpoints[provider], {
        headers: { Authorization: `Bearer ${key}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) return { ...group, message: `模型列表获取失败（HTTP ${response.status}），请检查 Key 权限或稍后刷新。` };
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) return { ...group, message: '服务商返回的模型列表格式无效。' };
      // 查询期间替换 Key 时不发布旧凭据对应的可见模型。
      const latest = await settings.load();
      if (!latest.ok || (provider === 'openai' ? latest.settings.openai : latest.settings.ai).credentialId !== config.credentialId)
        return { ...group, message: 'API Key 已变更，请刷新模型列表。' };
      const visible = new Set(parsed.data.data.map(model => model.id));
      group.models = ONLINE_MODELS.filter(model => model.provider === provider && visible.has(model.id))
        .map(({ id, name }) => ({ id, name }));
      if (!group.models.length) group.message = '此 Key 暂无当前应用支持的对话模型。';
      return group;
    } catch {
      return { ...group, message: '无法获取模型列表，请检查网络与系统代理后刷新。' };
    }
  }));
  return [...groups, { id: 'offline', name: '离线模型', models: [{ id: LOCAL_MODEL.id, name: LOCAL_MODEL.name }] }];
}
