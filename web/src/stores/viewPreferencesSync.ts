import api from '../services/api';
import { usePMStore, _setDebouncedSave } from './pmStore';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const preferences = usePMStore.getState()._getServerPayload();
    api.put('/view-preferences', { preferences }).catch(() => {});
  }, 2000);
}

_setDebouncedSave(debouncedSave);

export async function loadViewPreferences() {
  try {
    const res = await api.get('/view-preferences');
    const prefs = res.data?.data?.preferences;
    if (prefs && typeof prefs === 'object' && Object.keys(prefs).length > 0) {
      usePMStore.getState()._hydrateFromServer(prefs);
    }
  } catch {
    // Server preferences unavailable — localStorage values remain active
  }
}
