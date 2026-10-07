import { z } from 'zod';

// 模型目录只描述已接入的选项，不接受页面提供任意 endpoint 或权重路径。
export const ONLINE_MODELS = [{ id: 'deepseek-flash', provider: 'deepseek', name: 'DeepSeek Flash' }] as const;
export const LOCAL_MODEL = { id: 'Qwen3.5-4B', name: 'Qwen3.5-4B' } as const;
export const modelSelectionSchema = z.object({
  mode: z.enum(['online', 'offline']),
  onlineModel: z.string().refine(id => ONLINE_MODELS.some(model => model.id === id), '在线模型未接入。')
}).strict();
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export const defaultModelSelection = (): ModelSelection => ({ mode: 'online', onlineModel: ONLINE_MODELS[0].id });
export function selectedModelName(selection: ModelSelection) {
  return selection.mode === 'offline' ? LOCAL_MODEL.name : ONLINE_MODELS.find(model => model.id === selection.onlineModel)?.name ?? selection.onlineModel;
}

// 仅主进程与 Worker 传递；凭据、随机回环端口不暴露给 renderer。
export type ModelTarget =
  | { provider: 'deepseek'; modelId: string; apiKey: string }
  | { provider: 'Qwen-3.5-4B-local'; modelId: string; apiKey: string; baseUrl: string };
