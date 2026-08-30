import type { Recipe } from "@webmcp-anywhere/shared";
import { Link } from "react-router-dom";

export function RecipeCard({ recipe }: { recipe: Recipe }) {
  const n = recipe.tools.length;
  return (
    <Link to={`/recipes/${encodeURIComponent(recipe.id)}`} className="card recipe-card">
      <div className="recipe-card-head">
        <h3>{recipe.name}</h3>
        <span className="pill">
          {n} tool{n === 1 ? "" : "s"}
        </span>
      </div>
      <p className="muted clamp-2">{recipe.description || "No description."}</p>
      <ul className="match-list">
        {recipe.matches.slice(0, 3).map((m) => (
          <li key={m}>
            <code>{m}</code>
          </li>
        ))}
        {recipe.matches.length > 3 && <li className="muted">+{recipe.matches.length - 3} more</li>}
      </ul>
    </Link>
  );
}
