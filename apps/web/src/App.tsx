import { NavLink, Route, Routes } from 'react-router-dom';
import { Logo } from './components/Logo';
import { Analyze } from './pages/Analyze';
import { Docs } from './pages/Docs';
import { Signals } from './pages/Signals';

function NotFound() {
  return (
    <div className="empty">
      <h3>That page does not exist</h3>
      <p>
        Try the <a href="/">analyser</a> or the <a href="/docs">documentation</a>.
      </p>
    </div>
  );
}

export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <Logo />
          <span>
            Wallet Sleuth <small>on-chain linkage</small>
          </span>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Analyse
          </NavLink>
          <NavLink to="/signals">Signals</NavLink>
          <NavLink to="/docs">Docs</NavLink>
          <a href="/docs/api" target="_blank" rel="noreferrer">
            API
          </a>
        </nav>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Analyze />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/:slug" element={<Docs />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="footer">
        <span>
          Wallet Sleuth reads public blockchain data only. It does not identify people, and a link is evidence to check,
          not a verdict.
        </span>
        <span>
          <a href="/docs/privacy-and-ethics">Ethics</a> · <a href="/docs/interpreting-results">How to read a score</a>{' '}
          ·{' '}
          <a href="https://github.com/nirholas/wallet-sleuth">Source</a> ·{' '}
          <span>&copy; 2026 nirholas. All rights reserved.</span>
        </span>
      </footer>
    </div>
  );
}
