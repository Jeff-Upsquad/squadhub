'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import ThemeProvider from '../components/ThemeProvider';
import ServiceWorkerRegistrar from '../components/ServiceWorkerRegistrar';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ServiceWorkerRegistrar />
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}
