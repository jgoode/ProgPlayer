import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Renderer root container #root was not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
