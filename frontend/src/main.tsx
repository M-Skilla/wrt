import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiError } from './lib/api';
import { IdentityProvider } from './lib/identity';
import { ToastProvider } from './lib/tx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      // Don't retry chaincode errors (404, 403, ...); do retry a briefly unreachable API.
      retry: (count, err) => count < 2 && (!(err instanceof ApiError) || err.status === 0 || err.status >= 500),
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <IdentityProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </IdentityProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
