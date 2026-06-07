import { GAIN_COLOR, LOSS_COLOR } from '../utils/finance';

export type AiConnectionState = 'unknown' | 'checking' | 'connected' | 'failed' | 'not_configured';

export function defaultModel(provider: string): string {
  return provider === 'openai' ? 'gpt-4o-mini' : 'openai/gpt-4o-mini';
}

export function AiSettingsModal({
  apiKey,
  configured,
  connectionMessage,
  connectionState,
  error,
  loading,
  model,
  onApiKeyChange,
  onClose,
  onModelChange,
  onProviderChange,
  onSave,
  onSystemPromptChange,
  onTestConnection,
  open,
  provider,
  saving,
  systemPrompt,
  testingConnection,
}: {
  apiKey: string;
  configured: boolean;
  connectionMessage: string;
  connectionState: AiConnectionState;
  error: string;
  loading: boolean;
  model: string;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onModelChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onSave: () => void;
  onSystemPromptChange: (value: string) => void;
  onTestConnection: () => void;
  open: boolean;
  provider: string;
  saving: boolean;
  systemPrompt: string;
  testingConnection: boolean;
}) {
  if (!open) return null;

  const isConnected = connectionState === 'connected';
  const isFailed = connectionState === 'failed';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="config-modal" onClick={event => event.stopPropagation()}>
        <header>
          <h2>AI Settings</h2>
          <button onClick={onClose} type="button">Close</button>
        </header>
        <p className="muted">{configured ? 'Global AI is configured. Leave API key blank to keep the saved key.' : 'Set the shared OpenAI or OpenRouter key once.'}</p>
        {error && <p className="error-text">{error}</p>}
        <div className="connection-box" style={{ color: isConnected ? GAIN_COLOR : isFailed ? LOSS_COLOR : '#475569' }}>
          {connectionState === 'checking' || testingConnection
            ? 'Testing connection...'
            : isConnected
              ? connectionMessage || 'Connection successful.'
              : isFailed
                ? connectionMessage || 'Cannot connect.'
                : connectionState === 'not_configured'
                  ? 'No API key saved yet.'
                  : 'Connection status unknown.'}
        </div>
        <label>
          Provider
          <select disabled={loading || saving} onChange={event => onProviderChange(event.target.value)} value={provider}>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </label>
        <label>
          API key
          <input autoComplete="off" disabled={loading || saving} onChange={event => onApiKeyChange(event.target.value)} placeholder={configured ? 'Leave blank to keep saved key' : 'sk-...'} type="password" value={apiKey} />
        </label>
        <label>
          Model
          <input disabled={loading || saving} onChange={event => onModelChange(event.target.value)} placeholder={defaultModel(provider)} value={model} />
        </label>
        <label>
          System prompt
          <textarea disabled={loading || saving} onChange={event => onSystemPromptChange(event.target.value)} rows={3} value={systemPrompt} />
        </label>
        <footer>
          <span className="muted">{loading ? 'Loading...' : configured ? 'Configured' : 'Not configured'}</span>
          <div className="button-row">
            <button disabled={loading || saving || testingConnection || !configured} onClick={onTestConnection} type="button">Test</button>
            <button disabled={loading || saving || testingConnection} onClick={onSave} type="button">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
