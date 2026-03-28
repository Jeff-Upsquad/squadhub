import { useState, useEffect } from 'react';

interface Props {
  startTime: string;
  className?: string;
}

export default function TimerDisplay({ startTime, className = '' }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startTime).getTime();
    const update = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <span className={`tabular-nums font-mono ${className}`}>
      {pad(hours)}:{pad(minutes)}:{pad(seconds)}
    </span>
  );
}
