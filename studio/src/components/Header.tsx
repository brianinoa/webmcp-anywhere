import { Link, NavLink } from "react-router-dom";
import { useWebMCPStatus } from "../hooks";

export function Header() {
  const status = useWebMCPStatus();
  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            Recipe Studio <span className="muted brand-sub">WebMCP Anywhere</span>
          </span>
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Browse
          </NavLink>
          <NavLink to="/recipes/new" className="btn btn-primary btn-sm">
            New recipe
          </NavLink>
          <span className={`status-dot status-${status}`} title={`WebMCP: ${status}`} aria-label={`WebMCP ${status}`} />
        </nav>
      </div>
    </header>
  );
}
