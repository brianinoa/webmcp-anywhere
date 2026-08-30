import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="empty-state">
      <h2>Page not found</h2>
      <Link to="/" className="btn">
        Back to recipes
      </Link>
    </div>
  );
}
