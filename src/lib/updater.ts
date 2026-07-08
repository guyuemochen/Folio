import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';

/**
 * Auto-update (M9, PRD §10.3 whitelist: user-initiated checks only).
 *
 * Three release channels — stable / beta / nightly — each backed by its own
 * GitHub Releases rolling tag (`<channel>-latest/latest.json`). The channel
 * is a per-user preference persisted in localStorage; the Rust side resolves
 * it to the right endpoint so JS never needs to know URLs.
 */

export type UpdateChannel = 'stable' | 'beta' | 'nightly';

const CHANNEL_KEY = 'folio:update-channel';

export function getUpdateChannel(): UpdateChannel {
  const c = localStorage.getItem(CHANNEL_KEY);
  return c === 'beta' || c === 'nightly' ? c : 'stable';
}

export function setUpdateChannel(channel: UpdateChannel): void {
  localStorage.setItem(CHANNEL_KEY, channel);
}

export interface UpdateCheckResult {
  /** True when a newer version is available on the configured channel. */
  available: boolean;
  /** The new version string, e.g. "0.2.0" (undefined when `available` is false). */
  version?: string;
  /** The channel that was checked. */
  channel: UpdateChannel;
}

/** Check the configured channel for an available update. */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const channel = getUpdateChannel();
  const version = await invoke<string | null>('check_for_update_with_channel', { channel });
  return { available: !!version, version: version ?? undefined, channel };
}

/**
 * Download + install the update on the configured channel, then relaunch.
 * Throws if the download/install fails or if no update is currently available.
 */
export async function installUpdate(): Promise<void> {
  const channel = getUpdateChannel();
  await invoke('install_update_with_channel', { channel });
  await relaunch();
}
