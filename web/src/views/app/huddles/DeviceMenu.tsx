'use client';

import { useCallback, useState } from 'react';
import { useMediaDeviceSelect } from '@livekit/components-react';
import { canPickSpeaker, deviceLabel, type HuddleDeviceKind } from './devices';

// Google-Meet-style device picker that pops up from the chevron next to the
// mic / camera buttons. "audio" lists microphones and (where the browser
// can route sound) speakers; "video" lists cameras. Switching goes through
// LiveKit's switchActiveDevice so a live track is re-acquired on the new
// device, and the room's ActiveDeviceChanged event persists the pick.
// Dismissal (outside click / Escape) is owned by the anchor that opens it.

export type DeviceMenuKind = 'audio' | 'video';

export default function DeviceMenu({
  kind,
  onClose,
  onNotice,
}: {
  kind: DeviceMenuKind;
  onClose: () => void;
  onNotice: (msg: string) => void;
}) {
  return (
    <div className="hd-devmenu" role="menu" aria-label={kind === 'audio' ? 'Audio devices' : 'Video devices'}>
      {kind === 'audio' ? (
        <>
          <DeviceSection kind="audioinput" title="Microphone" onNotice={onNotice} onPicked={onClose} />
          {canPickSpeaker() && <DeviceSection kind="audiooutput" title="Speakers" onNotice={onNotice} onPicked={onClose} />}
        </>
      ) : (
        <DeviceSection kind="videoinput" title="Camera" onNotice={onNotice} onPicked={onClose} />
      )}
    </div>
  );
}

const SECTION_ICON: Record<HuddleDeviceKind, string> = {
  audioinput: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3',
  audiooutput: 'M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14',
  videoinput: 'M15 10l4.5-2.5v9L15 14M4 6h11v12H4z',
};

function DeviceSection({
  kind,
  title,
  onNotice,
  onPicked,
}: {
  kind: HuddleDeviceKind;
  title: string;
  onNotice: (msg: string) => void;
  onPicked: () => void;
}) {
  const [switching, setSwitching] = useState<string | null>(null);
  // The hook rebuilds its device observable whenever onError's identity
  // changes, and that re-emits devices → re-render → new callback → loop.
  // Keep it stable.
  const onError = useCallback(
    (e: Error) => {
      if (e?.name === 'NotAllowedError') onNotice(`${title} access is blocked — allow it in your browser settings`);
    },
    [onNotice, title],
  );
  // requestPermissions: the menu only mounts while open, so asking here
  // (once, for labels) is the same moment Meet would ask — and for a kind
  // that's already live it's a no-op.
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
    kind,
    requestPermissions: true,
    onError,
  });

  const pick = async (id: string) => {
    if (id === activeDeviceId || switching) return;
    setSwitching(id);
    try {
      await setActiveMediaDevice(id);
      onPicked();
    } catch (e: any) {
      onNotice(e?.message || `Could not switch ${title.toLowerCase()}`);
    } finally {
      setSwitching(null);
    }
  };

  // A live track may be on the concrete id while the list also has the
  // browser's "default" alias for the same hardware; treat both as active.
  const isActive = (d: MediaDeviceInfo) =>
    d.deviceId === activeDeviceId || (!activeDeviceId && d.deviceId === 'default');

  return (
    <div className="hd-devmenu__section">
      <div className="hd-devmenu__title">
        <svg fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d={SECTION_ICON[kind]} />
        </svg>
        {title}
      </div>
      {devices.length === 0 ? (
        <div className="hd-devmenu__empty">No {title.toLowerCase()} found</div>
      ) : (
        devices.map((d, i) => {
          const active = isActive(d);
          return (
            <button
              key={d.deviceId || i}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`hd-devmenu__item${active ? ' is-active' : ''}`}
              disabled={!!switching}
              onClick={() => pick(d.deviceId)}
            >
              <span className="hd-devmenu__check" aria-hidden>
                {switching === d.deviceId ? (
                  <span className="hd-devmenu__spin" />
                ) : active ? (
                  <svg fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                ) : null}
              </span>
              <span className="truncate">{deviceLabel(d, i)}</span>
            </button>
          );
        })
      )}
    </div>
  );
}
