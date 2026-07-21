import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getVersion } from '@tauri-apps/api/app';
import { useDialog } from '../lib/dialog';
import {
  checkForUpdate,
  installUpdate,
  getUpdateChannel,
  setUpdateChannel,
  type UpdateChannel,
} from '../lib/updater';

interface AboutModalProps {
  onClose: () => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'available'; version: string }
  | { kind: 'installing' }
  | { kind: 'error'; message: string };

const CHANNELS: { id: UpdateChannel; labelKey: string; hintKey: string }[] = [
  { id: 'stable', labelKey: 'about.channelStable', hintKey: 'about.channelStableHint' },
  { id: 'nightly', labelKey: 'about.channelNightly', hintKey: 'about.channelNightlyHint' },
];

/**
 * About dialog (M9) — app metadata, license, and the auto-update surface.
 *
 * Surfaces the two release channels (stable / nightly) and a user-initiated
 * "Check for updates" button (PRD §10.3 whitelist: no background checks,
 * no telemetry). The actual version probing + download happens via the
 * Rust commands in `src/lib/updater.ts`.
 */
export function AboutModal({ onClose }: AboutModalProps) {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');
  const [channel, setChannel] = useState<UpdateChannel>('stable');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const dialog = useDialog({ onClose, label: t('about.title') });

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion('0.1.0'));
    setChannel(getUpdateChannel());
  }, []);

  const handleCheck = async () => {
    if (status.kind === 'checking' || status.kind === 'installing') return;
    setStatus({ kind: 'checking' });
    // Apply the user's current channel selection before checking.
    setUpdateChannel(channel);
    try {
      const result = await checkForUpdate();
      setStatus(
        result.available && result.version
          ? { kind: 'available', version: result.version }
          : { kind: 'upToDate' },
      );
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleInstall = async () => {
    if (status.kind !== 'available') return;
    setStatus({ kind: 'installing' });
    try {
      // installUpdate() relaunches the app on success; if it returns, the
      // update was installed and a relaunch is pending.
      await installUpdate();
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[900] bg-black/20 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        {...dialog.containerProps}
        className="w-[420px] bg-bg-page rounded-lg shadow-popover border border-border-hairline flex flex-col"
      >
        <header className="px-5 py-3 border-b border-border-hairline flex items-center">
          <h2 className="text-h3 flex-1">{t('about.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary px-2"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </header>

        <div className="p-5 space-y-5">
          {/* App identity */}
          <div className="flex items-center gap-3">
            <span className="text-3xl">📝</span>
            <div>
              <div className="text-[15px] font-medium text-text-primary">Folio</div>
              <div className="text-[12px] text-text-tertiary">
                {t('about.version')} {version}
              </div>
            </div>
          </div>

          <p className="text-[12px] text-text-secondary leading-relaxed">
            {t('about.tagline')}
          </p>

          {/* License */}
          <div className="text-[12px] text-text-tertiary border-t border-border-hairline pt-3">
            {t('about.licenseLabel')}{' '}
            <span className="text-text-secondary">Apache-2.0</span>
          </div>

          {/* Update channel */}
          <div className="border-t border-border-hairline pt-4">
            <div className="text-[12px] font-medium text-text-primary mb-2">
              {t('about.updateChannel')}
            </div>
            <div className="space-y-1.5">
              {CHANNELS.map((c) => {
                const active = channel === c.id;
                return (
                  <label
                    key={c.id}
                    className={[
                      'flex items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer transition-colors',
                      active ? 'bg-bg-active' : 'hover:bg-bg-hover',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="update-channel"
                      checked={active}
                      onChange={() => {
                        setChannel(c.id);
                        setStatus({ kind: 'idle' });
                      }}
                      className="mt-0.5 accent-accent"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-text-primary">{t(c.labelKey)}</span>
                      <span className="block text-[11px] text-text-tertiary">{t(c.hintKey)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-text-tertiary/80">{t('about.channelPrivacy')}</p>
          </div>
        </div>

        {/* Update action */}
        <footer className="px-5 py-3 border-t border-border-hairline flex items-center gap-2">
          <StatusLine status={status} t={t} />
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-sm rounded bg-bg-section hover:bg-bg-hover text-text-primary"
            >
              {t('common.close')}
            </button>
            {status.kind === 'available' ? (
              <button
                type="button"
                onClick={handleInstall}
                className="px-3 py-1 text-sm rounded bg-accent hover:bg-accent-hover text-white"
              >
                {t('about.downloadInstall')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCheck}
                disabled={status.kind === 'checking' || status.kind === 'installing'}
                className="px-3 py-1 text-sm rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {status.kind === 'checking'
                  ? t('about.checking')
                  : status.kind === 'installing'
                    ? t('about.installing')
                    : t('about.checkForUpdates')}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function StatusLine({
  status,
  t,
}: {
  status: Status;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  switch (status.kind) {
    case 'idle':
      return <span className="text-[12px] text-text-tertiary" />;
    case 'checking':
      return <span className="text-[12px] text-text-tertiary animate-pulse">{t('about.checkingStatus')}</span>;
    case 'upToDate':
      return <span className="text-[12px] text-status-green">{t('about.upToDate')}</span>;
    case 'available':
      return (
        <span className="text-[12px] text-text-primary">
          {t('about.updateAvailable', { version: status.version })}
        </span>
      );
    case 'installing':
      return (
        <span className="text-[12px] text-text-tertiary animate-pulse">{t('about.installingStatus')}</span>
      );
    case 'error':
      return <span className="text-[12px] text-status-red truncate max-w-[180px]" title={status.message}>{status.message}</span>;
  }
}
