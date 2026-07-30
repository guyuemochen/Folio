/**
 * AI settings panel — embedded as one tab inside the global SettingsModal.
 *
 * Loads config from the workspace DB on mount, lets the user edit
 * enable/provider/apiKey/model/baseUrl, and provides a "Test connection"
 * button that fires a tiny "hi" request at the chosen provider. State is
 * local until "Save" is pressed; Save persists to `ai_settings` (one row
 * per field) and resets the agent's conversation memory.
 *
 * Backend contract: src-tauri/src/agent/mod.rs (`ai_get_config` /
 * `ai_save_config` / `ai_test_connection` Tauri commands).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/invoke';
import type { AiSettings as AiSettingsData } from '../lib/types';

type TestStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; message: string }
  | { state: 'fail'; error: string };

type SaveStatus = 'idle' | 'saving' | 'saved';

const PROVIDERS = [
  { id: 'openai', labelKey: 'settings.aiProviderOpenai' },
  { id: 'anthropic', labelKey: 'settings.aiProviderAnthropic' },
  { id: 'ollama', labelKey: 'settings.aiProviderOllama' },
  { id: 'custom', labelKey: 'settings.aiProviderCustom' },
] as const;

const DEFAULTS: AiSettingsData = {
  enabled: false,
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o-mini',
  baseUrl: '',
};

export function AiSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AiSettingsData | null>(null);
  const [test, setTest] = useState<TestStatus>({ state: 'idle' });
  const [save, setSave] = useState<SaveStatus>('idle');

  useEffect(() => {
    let cancelled = false;
    api
      .aiGetConfig()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        if (!cancelled) setSettings({ ...DEFAULTS });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings) {
    return <div className="text-[12px] text-text-tertiary">{t('common.loading')}</div>;
  }

  const update = (patch: Partial<AiSettingsData>): void => {
    setSettings({ ...settings, ...patch });
    setSave('idle');
    setTest({ state: 'idle' });
  };

  /**
   * Toggle the master-enable flag and persist it immediately. Unlike the
   * other fields (which wait for the explicit Save button), the enable
   * switch saves on toggle — matching the General tab's toggles and ensuring
   * the user's choice survives closing the dialog without clicking Save.
   * On failure the checkbox rolls back so the UI never lies about stored
   * state. Only the `enabled` field is touched; provider/key/model/baseUrl
   * are left for the Save button.
   */
  const handleToggleEnabled = async (next: boolean): Promise<void> => {
    const prev = settings.enabled;
    setSettings({ ...settings, enabled: next });
    setTest({ state: 'idle' });
    try {
      await api.aiSetEnabled(next);
    } catch (e) {
      // Roll back the optimistic flip on failure.
      setSettings((s) => (s ? { ...s, enabled: prev } : s));
      setTest({ state: 'fail', error: String(e) });
    }
  };

  const handleSave = async (): Promise<void> => {
    setSave('saving');
    try {
      await api.aiSaveConfig(settings);
      setSave('saved');
    } catch (e) {
      setSave('idle');
      setTest({ state: 'fail', error: String(e) });
    }
  };

  const handleTest = async (): Promise<void> => {
    setTest({ state: 'testing' });
    try {
      const msg = await api.aiTestConnection(settings);
      setTest({ state: 'ok', message: msg });
    } catch (e) {
      setTest({ state: 'fail', error: String(e) });
    }
  };

  const isOllama = settings.provider === 'ollama';

  return (
    <div className="space-y-5">
      {/* Enable — persisted immediately on toggle (unlike the other fields,
          which wait for the explicit Save button), so closing Settings
          without Save still keeps the master switch. */}
      <section>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => void handleToggleEnabled(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span className="flex-1">
            <span className="block text-[13px] font-medium text-text-primary">
              {t('settings.aiEnable')}
            </span>
            <span className="block text-[11px] text-text-tertiary mt-0.5">
              {t('settings.aiEnableHint')}
            </span>
          </span>
        </label>
      </section>

      {/* Provider */}
      <section>
        <label className="block text-[12px] font-medium text-text-primary mb-1.5">
          {t('settings.aiProvider')}
        </label>
        <select
          value={settings.provider}
          onChange={(e) => update({ provider: e.target.value as AiSettingsData['provider'] })}
          className="w-full px-3 py-1.5 rounded-md border border-border-hairline bg-bg-section text-[13px] text-text-primary focus:border-text-placeholder focus:outline-none"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.labelKey)}
            </option>
          ))}
        </select>
      </section>

      {/* API Key */}
      <section>
        <label className="block text-[12px] font-medium text-text-primary mb-1.5">
          {t('settings.aiApiKey')}
        </label>
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => update({ apiKey: e.target.value })}
          placeholder={isOllama ? t('settings.aiApiKeyPlaceholderOllama') : 'sk-...'}
          className="w-full px-3 py-1.5 rounded-md border border-border-hairline bg-bg-section text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-text-placeholder focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1 text-[11px] text-text-tertiary">{t('settings.aiApiKeyHint')}</p>
      </section>

      {/* Model */}
      <section>
        <label className="block text-[12px] font-medium text-text-primary mb-1.5">
          {t('settings.aiModel')}
        </label>
        <input
          type="text"
          value={settings.model}
          onChange={(e) => update({ model: e.target.value })}
          className="w-full px-3 py-1.5 rounded-md border border-border-hairline bg-bg-section text-[13px] text-text-primary focus:border-text-placeholder focus:outline-none"
          spellCheck={false}
        />
      </section>

      {/* Base URL */}
      <section>
        <label className="block text-[12px] font-medium text-text-primary mb-1.5">
          {t('settings.aiBaseUrl')}
        </label>
        <input
          type="text"
          value={settings.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder={isOllama ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'}
          className="w-full px-3 py-1.5 rounded-md border border-border-hairline bg-bg-section text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-text-placeholder focus:outline-none"
          spellCheck={false}
        />
        <p className="mt-1 text-[11px] text-text-tertiary">{t('settings.aiBaseUrlHint')}</p>
      </section>

      {/* Save + Test */}
      <section className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={save === 'saving'}
          className="px-3 py-1 text-[13px] rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-50"
        >
          {save === 'saving' ? t('settings.aiSaving') : save === 'saved' ? t('settings.aiSaved') : t('settings.aiSave')}
        </button>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={test.state === 'testing' || save === 'saving'}
          className="px-3 py-1 text-[13px] rounded border border-border-hairline hover:bg-bg-hover text-text-primary disabled:opacity-50"
        >
          {test.state === 'testing' ? t('settings.aiTesting') : t('settings.aiTest')}
        </button>
        {test.state === 'ok' && (
          <span className="text-[11px] text-green-600 dark:text-green-400">
            {t('settings.aiTestOk', { message: test.message })}
          </span>
        )}
        {test.state === 'fail' && (
          <span className="text-[11px] text-red-600 dark:text-red-400">
            {t('settings.aiTestFail', { error: test.error })}
          </span>
        )}
      </section>

      {/* Privacy */}
      <p className="text-[11px] text-text-tertiary/80 border-t border-border-hairline pt-3 leading-relaxed">
        {t('settings.aiPrivacy')}
      </p>
    </div>
  );
}
