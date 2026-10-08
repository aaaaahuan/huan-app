import { LOCAL_MODEL, ONLINE_MODELS, type ModelSelection } from '@shared/contracts/models';
import { Select } from '@renderer/components/Select';

export function ModelSwitcher({ selection, disabled, onChange }: {
  selection?: ModelSelection; disabled: boolean; onChange(selection: ModelSelection): void;
}) {
  const options = [
    ...ONLINE_MODELS.map(model => ({ value: model.id, label: `在线 · ${model.name}` })),
    { value: 'offline', label: `离线 · ${LOCAL_MODEL.name}` }
  ];
  return <div className="model-switcher" aria-label="AI 模型选择">
    <Select aria-label="AI 运行模式与模型" value={selection?.mode === 'offline' ? 'offline' : selection?.onlineModel ?? ONLINE_MODELS[0].id}
      disabled={disabled || !selection} options={options} onValueChange={value => {
        if (!selection) return;
        if (value === 'offline') onChange({ ...selection, mode: 'offline' });
        else if (ONLINE_MODELS.some(model => model.id === value)) onChange({ mode: 'online', onlineModel: value });
      }} />
  </div>;
}
