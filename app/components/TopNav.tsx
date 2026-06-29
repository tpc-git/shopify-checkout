// Shared header/nav, mirroring the tpc-estimator topbar pattern.

export function TopNav({ active }: { active: 'dashboard' | 'settings' }) {
  return (
    <header className="topbar">
      <a href="/" className="logo-link" aria-label="Tacoma Parts Corporation home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Tacoma Parts Corporation" className="logo" />
      </a>
      <span className="sub">Checkout Notifier</span>
      <nav className="topnav">
        <a href="/" className={active === 'dashboard' ? 'active' : ''}>
          Dashboard
        </a>
        <a href="/settings" className={active === 'settings' ? 'active' : ''}>
          Settings
        </a>
      </nav>
    </header>
  );
}
