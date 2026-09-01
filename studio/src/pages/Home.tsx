import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { RecipeCard } from "../components/RecipeCard";
import { useAsync, useDebounced } from "../hooks";

const REPO_URL = "https://github.com/brianinoa/webmcp-anywhere";

function RemoteBlurb() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const clean = code.toUpperCase().replace(/[^A-Z2-9]/g, "");
  const valid = clean.length >= 6 && clean.length <= 16;
  return (
    <section className="remote-blurb">
      <div>
        <h2>Remote control your recipes</h2>
        <p className="muted">
          Enable remote control from the extension on your computer, then open the code on your phone to tap-run its tools
          from across the room.
        </p>
      </div>
      <form
        className="remote-blurb-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) navigate(`/remote/${clean}`);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter a room code"
          aria-label="Room code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="btn btn-primary" type="submit" disabled={!valid}>
          Connect
        </button>
      </form>
    </section>
  );
}

export function Home() {
  const [q, setQ] = useState("");
  const [site, setSite] = useState("");
  const dq = useDebounced(q);
  const dsite = useDebounced(site);
  const { data, error, loading } = useAsync(() => api.list({ q: dq, site: dsite }), [dq, dsite]);
  const filtering = Boolean(dq || dsite);

  return (
    <>
      <section className="hero">
        <h1>Bring WebMCP tools to every website.</h1>
        <p className="lede">
          <strong>WebMCP Anywhere</strong> is a Chrome extension that retrofits structured agent tools (
          <code>document.modelContext</code>) onto any page: a generic layer for clicking, filling, and reading, plus
          per-site <em>recipes</em> that expose what a site can really do. This studio is where recipes are authored,
          tested, and shared — and it is a WebMCP site itself, so an agent can author recipes here too.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href={REPO_URL} target="_blank" rel="noreferrer">
            Install the extension
          </a>
          <Link className="btn" to="/recipes/new">
            Write a recipe
          </Link>
        </div>
        <ol className="steps">
          <li>
            <span className="step-n">1</span>
            <div>
              <strong>Install</strong>
              <span>Load the extension. Every page gets generic tools instantly.</span>
            </div>
          </li>
          <li>
            <span className="step-n">2</span>
            <div>
              <strong>Sync recipes</strong>
              <span>The extension pulls recipes from this studio and registers site-specific tools where they match.</span>
            </div>
          </li>
          <li>
            <span className="step-n">3</span>
            <div>
              <strong>Let agents act</strong>
              <span>ChatGPT's browser, Chrome, or any WebMCP client calls the tools; sensitive ones ask you first.</span>
            </div>
          </li>
        </ol>
      </section>

      <RemoteBlurb />

      <section className="browse">
        <div className="browse-head">
          <h2>Recipes</h2>
          <div className="filters">
            <input type="search" placeholder="Search recipes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search recipes" />
            <input
              type="url"
              placeholder="Paste a URL to see which recipes apply"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              aria-label="Filter by site URL"
            />
          </div>
        </div>

        {error && <p className="alert">Could not load recipes: {error}</p>}
        {loading && !data && <p className="muted">Loading…</p>}
        {data && data.length === 0 && (
          <div className="empty-state">
            <p>{filtering ? "No recipes match." : "No recipes yet."}</p>
            <Link to="/recipes/new" className="btn btn-primary">
              Create the first one
            </Link>
          </div>
        )}
        {data && data.length > 0 && (
          <div className="grid">
            {data.map((r) => (
              <RecipeCard key={r.id} recipe={r} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
