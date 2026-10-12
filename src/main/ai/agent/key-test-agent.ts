import type { AgentConfig } from './agent';

export function createKeyTestAgentConfig(
  keyForRun: (runId: string) => string | undefined
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
      const apiKey = keyForRun(runId);
      if (!apiKey) throw new Error('KEY_TEST_CREDENTIAL_MISSING');
      return { provider: 'deepseek', modelId: 'deepseek-flash', apiKey };
    }
  };
}
