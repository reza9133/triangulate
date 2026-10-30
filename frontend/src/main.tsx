import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { ThemeProvider } from './components/Theme';
import { TxProvider } from './components/Tx';
import { WalletProvider } from './wallet/WalletContext';
import './styles/global.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <WalletProvider>
        <TxProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
            <App />
          </BrowserRouter>
        </TxProvider>
      </WalletProvider>
    </ThemeProvider>
  </StrictMode>,
);
