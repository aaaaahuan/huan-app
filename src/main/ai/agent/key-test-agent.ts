import type { ModelTarget } from '@shared/contracts/models';
import type { AgentConfig } from './agent';

export function createKeyTestAgentConfig(
  keyForRun: (runId: string) => ModelTarget | undefined
): AgentConfig<Record<string, never>> {
  return {
    key: 'key-test',
    history: 'isolated',
    systemPrompt: '',
    tools: [],
    thinkingLevel: 'off',
    maxOutputTokens: 8,
    resolveModelTarget: async ({ runId, signal }) => {
      signal.throwIfAborted();
      const target = keyForRun(runId);
      if (!target) throw new Error('KEY_TEST_CREDENTIAL_MISSING');
      return target;
    }
  };
}
