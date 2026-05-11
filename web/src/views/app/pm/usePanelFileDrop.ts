import { useCallback, useRef, useState } from 'react';

export function usePanelFileDrop(onFiles: (files: FileList | File[]) => void) {
  const counter = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types || []).includes('Files');

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    counter.current += 1;
    setDragActive(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    counter.current = Math.max(0, counter.current - 1);
    if (counter.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    counter.current = 0;
    setDragActive(false);
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  }, [onFiles]);

  return {
    dragActive,
    panelHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
