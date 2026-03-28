import { useState } from 'react';
import api from '../../../services/api';

interface Props {
  startDate: string;
  endDate: string;
}

export default function ExportButton({ startDate, endDate }: Props) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/timer/export?start_date=${startDate}&end_date=${endDate}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `time-tracking-${startDate}-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 py-2 text-xs font-medium text-[#62748E] transition hover:bg-[#F8FAFC] disabled:opacity-50"
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      {loading ? 'Exporting...' : 'Export CSV'}
    </button>
  );
}
