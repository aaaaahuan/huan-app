import { LOCAL_MODEL, ONLINE_MODELS, type ModelSelection } from '@shared/contracts/models';
import { Select } from '@renderer/components/Select';

export function ModelSwitcher({ selection, disabled, onChange }: {
  selection?: ModelSelection; disabled: boolean; onChange(selection: ModelSelection): void;
}) {
  return <div className="model-switcher" aria-label="AI 模型选择">
    <Select<ModelSelection['mode']> aria-label="AI 运行模式" value={selection?.mode ?? 'online'} disabled={disabled || !selection}
      options={[{ value: 'online', label: '在线' }, { value: 'offline', label: '离线' }]}
      onValueChange={mode => { if (selection) onChange({ ...selection, mode }); }} />
    {selection?.mode === 'offline' ? <span className="local-model-name">{LOCAL_MODEL.name}</span>
      : <Select aria-label="在线模型" value={selection?.onlineModel ?? ONLINE_MODELS[0].id} disabled={disabled || !selection}
        options={ONLINE_MODELS.map(model => ({ value: model.id, label: model.name }))}
        onValueChange={onlineModel => { if (selection) onChange({ ...selection, onlineModel }); }} />}
  </div>;
}
