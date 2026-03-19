import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

// API client configured to talk to our backend
const api = axios.create({
  baseURL: '/', // In dev, Vite proxy sends /auth, /workspaces, etc. to localhost:4000
  headers: { 'Content-Type': 'application/json' },
});

// Attach auth token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 — clear auth state
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  },
);

export default api;
