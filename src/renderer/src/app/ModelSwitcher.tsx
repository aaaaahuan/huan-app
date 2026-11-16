import { useEffect, useRef, useState } from 'react';
import { LOCAL_MODEL, onlineProvider, selectedModelName, type ModelGroup, type ModelSelection } from '@shared/contracts/models';
import { CascadingSelect } from '@renderer/components/CascadingSelect';

const emptyGroups: ModelGroup[] = [
  { id: 'openai', name: 'OpenAI', models: [] }, { id: 'deepseek', name: 'DeepSeek', models: [] },
  { id: 'offline', name: '离线模型', models: [{ id: LOCAL_MODEL.id, name: LOCAL_MODEL.name }] }
];
export function ModelSwitcher({ selection, disabled, onChange, settingsRevision }: {
  selection?: ModelSelection; disabled: boolean; settingsRevision: number; onChange(selection: ModelSelection): void;
}) {
  const [groups, setGroups] = useState<ModelGroup[]>(emptyGroups);
  const [activeGroup, setActiveGroup] = useState('openai');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const sequence = useRef(0);
  const selectedGroup = selection?.mode === 'offline' ? 'offline' : onlineProvider(selection?.onlineModel ?? 'deepseek-flash');
  useEffect(() => { setActiveGroup(selectedGroup); }, [selectedGroup]);
  useEffect(() => {
    const call = ++sequence.current;
    setLoading(true); setError(''); setGroups(emptyGroups);
    void window.huanApp.ai.listModels().then(result => {
      if (sequence.current !== call) return;
      if (result.ok) setGroups(result.value); else setError(result.message);
    }).catch(() => { if (sequence.current === call) setError('无法获取模型列表，请刷新重试。'); })
      .finally(() => { if (sequence.current === call) setLoading(false); });
    return () => { sequence.current++; };
  }, [settingsRevision, refreshVersion]);
  return <div className="model-switcher" aria-label="AI 模型选择">
    <CascadingSelect label="AI 服务商与模型" value={selection ? `${selectedGroup === 'openai' ? 'OpenAI' : selectedGroup === 'deepseek' ? 'DeepSeek' : '离线'} · ${selectedModelName(selection)}` : '读取模型…'}
      groups={groups} activeGroup={activeGroup} selectedGroup={selectedGroup} selectedValue={selection?.mode === 'offline' ? LOCAL_MODEL.id : selection?.onlineModel ?? ''}
      disabled={disabled || !selection} loading={loading && activeGroup !== 'offline'} error={error} onGroupChange={setActiveGroup} onRefresh={() => setRefreshVersion(value => value + 1)}
      onSelect={(provider, id) => {
        if (!selection) return;
        onChange(provider === 'offline' ? { ...selection, mode: 'offline' } : { mode: 'online', onlineModel: id });
      }} />
  </div>;
}
