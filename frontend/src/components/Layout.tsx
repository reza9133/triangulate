import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { CONTRACT_ADDRESS, GENLAYER_URL, GITHUB_URL, X_HANDLE, X_URL, explorerAddress } from '../lib/config';
import { shortAddress } from '../lib/format';
import { GenLayerMark, LogoMark, Wordmark } from './Logo';
import { ThemeSwitch } from './Theme';
import { NetworkBanner, WalletButton, WalletModal } from './WalletUi';

const NAV = [
  { to: '/claims', label: 'Claims' },
  { to: '/new', label: 'New claim' },
  { to: '/inspect', label: 'Inspect URL' },
  { to: '/docs', label: 'Docs' },
  { to: '/about', label: 'About' },
];

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <>
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <header className="header">
        <div className="container header-inner">
          <Link to="/" aria-label="Triangulate home" style={{ textDecoration: 'none' }}>
            <Wordmark />
          </Link>
          <nav className={`nav${open ? ' open' : ''}`} aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            ))}
            <div className="nav-theme">
              <ThemeSwitch />
            </div>
          </nav>
          <div className="header-actions">
            <ThemeSwitch className="header-theme" />
            <WalletButton />
            <button
              className="btn icon burger"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              ☰
            </button>
          </div>
        </div>
      </header>
      <NetworkBanner />
      <main id="main">
        <Outlet />
      </main>
      <WalletModal />
      <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Wordmark size={28} />
          <p className="muted" style={{ marginTop: 12, maxWidth: '34ch' }}>
            How many independent voices really stand behind a claim? An Intelligent Contract that counts
            origins, not links.
          </p>
          <a className="built-on" href={GENLAYER_URL} target="_blank" rel="noreferrer">
            <GenLayerMark /> Built on GenLayer
          </a>
        </div>
        <div>
          <h4>App</h4>
          <ul>
            <li>
              <Link to="/claims">Claims</Link>
            </li>
            <li>
              <Link to="/new">New claim</Link>
            </li>
            <li>
              <Link to="/inspect">Inspect URL</Link>
            </li>
          </ul>
        </div>
        <div>
          <h4>Learn</h4>
          <ul>
            <li>
              <Link to="/docs">Documentation</Link>
            </li>
            <li>
              <Link to="/docs/contract-api">Contract API</Link>
            </li>
            <li>
              <Link to="/docs/threat-model">Threat model</Link>
            </li>
            <li>
              <Link to="/about">About</Link>
            </li>
          </ul>
        </div>
        <div>
          <h4>Links</h4>
          <ul>
            <li>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                GitHub ↗
              </a>
            </li>
            <li>
              <a href={X_URL} target="_blank" rel="noreferrer">
                X {X_HANDLE} ↗
              </a>
            </li>
            <li>
              <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
                Contract <span className="mono">{shortAddress(CONTRACT_ADDRESS)}</span> ↗
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="container row spread muted" style={{ marginTop: 30, fontSize: '0.82rem' }}>
        <span className="row" style={{ gap: 8 }}>
          <LogoMark size={16} animated={false} /> Triangulate · MIT licence · GenLayer Studionet
        </span>
        <span>Corroboration is not truth: read the evidence.</span>
      </div>
    </footer>
  );
}
