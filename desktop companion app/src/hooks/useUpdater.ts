import { useCallback, useEffect, useRef, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

export type UpdateStatus =
  | 'idle' // no check run yet (or silent check found nothing)
  | 'checking' // a manual check is in flight
  | 'uptodate' // manual check confirmed we're current
  | 'available' // a newer signed build is published
  | 'downloading' // download/install in progress
  | 'error';

export interface UpdaterState {
  status: UpdateStatus;
  currentVersion: string;
  newVersion: string | null;
  notes: string | null;
  /** 0–100 once the total size is known; null while indeterminate. */
  progress: number | null;
  error: string | null;
  check: (silent?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

/**
 * Wraps the Tauri updater for use in the Settings UI: exposes the current
 * version, a manual check, and a download-with-progress + relaunch install.
 * Auto-runs a silent check on mount so an available update surfaces on its own.
 */
export function useUpdater(autoCheck = true): UpdaterState {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [currentVersion, setCurrentVersion] = useState('');
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  const runCheck = useCallback(async (silent = false) => {
    if (!silent) setStatus('checking');
    setError(null);
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setNewVersion(update.version);
        setNotes(update.body ?? null);
        setStatus('available');
      } else {
        updateRef.current = null;
        setNewVersion(null);
        // Silent checks shouldn't flip an already-surfaced update or shout
        // "up to date" unprompted — only a manual check reports that.
        setStatus((s) => (silent ? (s === 'available' ? s : 'idle') : 'uptodate'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update check failed');
      if (!silent) setStatus('error');
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setStatus('downloading');
    setProgress(null);
    setError(null);
    let total = 0;
    let downloaded = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') {
          total = ev.data.contentLength ?? 0;
          setProgress(total ? 0 : null);
        } else if (ev.event === 'Progress') {
          downloaded += ev.data.chunkLength;
          if (total) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        } else if (ev.event === 'Finished') {
          setProgress(100);
        }
      });
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (autoCheck) void runCheck(true);
  }, [autoCheck, runCheck]);

  return { status, currentVersion, newVersion, notes, progress, error, check: runCheck, install };
}
