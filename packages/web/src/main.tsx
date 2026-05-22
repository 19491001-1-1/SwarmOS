/** SwarmOS web — React + Vite front-end, channel chat, observability panel, swarm init, agent management */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './pixel.css';
import { App } from './App.js';

const root = document.getElementById('root')!;
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
