import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root manquant');

if (!window.atelier) {
  root.textContent = 'Le pont avec le processus principal est indisponible. Relancez l’application.';
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
