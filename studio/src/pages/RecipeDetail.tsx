import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, notifyRecipesChanged } from "../api";
import { JsonBlock } from "../components/JsonBlock";
import { ToolCard } from "../components/ToolCard";
import { TryItPanel } from "../components/TryItPanel";
import { useAsync, useCopy } from "../hooks";

export function RecipeDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: recipe, error, loading } = useAsync(() => api.get(id), [id]);
  const [copied, copy] = useCopy();
  const [deleting, setDeleting] = useState(false);

  const onDelete = async () => {
    if (!recipe || !window.confirm(`Delete "${recipe.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(recipe.id);
      notifyRecipesChanged();
      navigate("/");
    } catch (e) {
      setDeleting(false);
      window.alert(`Delete failed: ${(e as Error).message}`);
    }
  };

  if (error) {
    return (
      <div className="empty-state">
        <h2>Recipe not found</h2>
        <p className="muted">{error}</p>
        <Link to="/" className="btn">
          Back to recipes
        </Link>
      </div>
    );
  }
  if (loading || !recipe) return <p className="muted">Loading…</p>;

  return (
    <div className="detail">
      <nav className="crumbs">
        <Link to="/">Recipes</Link> / <span>{recipe.name}</span>
      </nav>
      <header className="detail-head">
        <div>
          <h1>{recipe.name}</h1>
          <p className="lede">{recipe.description}</p>
          <div className="meta">
            <span>
              id <code>{recipe.id}</code>
            </span>
            <span>v{recipe.version}</span>
            {recipe.author && <span>by {recipe.author}</span>}
            {recipe.updatedAt && <span>updated {new Date(recipe.updatedAt).toLocaleDateString()}</span>}
          </div>
        </div>
        <div className="detail-actions">
          <button className="btn" onClick={() => copy(JSON.stringify(recipe, null, 2))}>
            {copied ? "Copied" : "Copy as JSON"}
          </button>
          <Link className="btn btn-primary" to={`/recipes/${encodeURIComponent(recipe.id)}/edit`}>
            Edit
          </Link>
          <button className="btn danger" onClick={onDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </header>

      <div className="detail-body">
        <div className="detail-main">
          <section>
            <h2>Applies to</h2>
            <ul className="match-list">
              {recipe.matches.map((m) => (
                <li key={m}>
                  <code>{m}</code>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>
              Tools <span className="pill">{recipe.tools.length}</span>
            </h2>
            <div className="stack">
              {recipe.tools.map((t) => (
                <ToolCard key={t.name} tool={t} />
              ))}
            </div>
          </section>
          <section>
            <JsonBlock summary="Full recipe JSON" value={recipe} />
          </section>
        </div>
        <TryItPanel recipeId={recipe.id} />
      </div>
    </div>
  );
}
