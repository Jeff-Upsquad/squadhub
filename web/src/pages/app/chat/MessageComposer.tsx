import { useState } from 'react';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';

export default function MessageComposer({ channelId, onSend }: { channelId: string; onSend: () => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api.post('/messages', { channel_id: channelId, content: text.trim(), type: 'text' });
      setText('');
      onSend();
    } catch (err) {
      console.error('Send message failed:', err);
    } finally {
      setSending(false);
    }
  };

  const handleTyping = () => {
    const socket = getSocket();
    if (socket) socket.emit('typing', { channel_id: channelId });
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-800 px-5 py-3">
      <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value); handleTyping(); }}
          placeholder="Type a message..."
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="rounded-md bg-brand-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </form>
  );
}
