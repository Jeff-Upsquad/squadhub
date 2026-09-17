import { Room, RoomEvent, type RoomOptions } from 'livekit-client';

// Device preferences for SquadUp calls (which mic / camera / speaker to
// use). Remembered per browser so the next call opens on the same devices,
// like Google Meet. Applied as capture defaults when a Room is built, and
// kept current from the room's ActiveDeviceChanged event whenever the user
// picks something in the in-call menu.

const STORAGE_KEY = 'squadhub-huddle-devices';

export type HuddleDeviceKind = 'audioinput' | 'audiooutput' | 'videoinput';
export type HuddleDevicePrefs = Partial<Record<HuddleDeviceKind, string>>;

export function loadDevicePrefs(): HuddleDevicePrefs {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveDevicePref(kind: HuddleDeviceKind, deviceId: string | undefined) {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...loadDevicePrefs() };
    // "default" is the browser's own pick — remembering it would pin the
    // user to whatever was default at the time, so store nothing instead.
    if (!deviceId || deviceId === 'default') delete next[kind];
    else next[kind] = deviceId;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode etc. — the pick still applies for this call */
  }
}

// Speaker selection only works where the browser lets us route audio
// (setSinkId): Chrome/Edge yes, Safari and WKWebView no.
export function canPickSpeaker(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

// Builds the Room every SquadUp surface uses (in-app dock and the guest
// page) with the remembered devices as defaults. A remembered device that
// has since been unplugged is harmless — deviceId is an `ideal` constraint,
// so getUserMedia falls back to the system default.
export function createHuddleRoom(extra?: RoomOptions): Room {
  const prefs = loadDevicePrefs();
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    ...extra,
    audioCaptureDefaults: { ...(prefs.audioinput ? { deviceId: prefs.audioinput } : {}), ...extra?.audioCaptureDefaults },
    videoCaptureDefaults: { ...(prefs.videoinput ? { deviceId: prefs.videoinput } : {}), ...extra?.videoCaptureDefaults },
    audioOutput: { ...(prefs.audiooutput && canPickSpeaker() ? { deviceId: prefs.audiooutput } : {}), ...extra?.audioOutput },
  });
  room.on(RoomEvent.ActiveDeviceChanged, (kind, deviceId) => {
    saveDevicePref(kind as HuddleDeviceKind, deviceId);
  });
  return room;
}

// enumerateDevices hides labels until permission is granted for that kind;
// give the user something to click on rather than a blank row.
export function deviceLabel(d: MediaDeviceInfo, index: number): string {
  if (d.label) return d.label;
  if (d.deviceId === 'default') return 'System default';
  const noun = d.kind === 'videoinput' ? 'Camera' : d.kind === 'audiooutput' ? 'Speaker' : 'Microphone';
  return `${noun} ${index + 1}`;
}
