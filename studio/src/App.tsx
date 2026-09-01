import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { RecipeDetail } from "./pages/RecipeDetail";
import { RecipeEditor } from "./pages/RecipeEditor";
import { Remote } from "./pages/Remote";
import { RemoteIndex } from "./pages/RemoteIndex";
import { setNavigator } from "./webmcp";

export function App() {
  const navigate = useNavigate();
  useEffect(() => {
    setNavigator((path) => navigate(path));
  }, [navigate]);

  return (
    <div className="app">
      <Header />
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/recipes/new" element={<RecipeEditor />} />
          <Route path="/recipes/:id" element={<RecipeDetail />} />
          <Route path="/recipes/:id/edit" element={<RecipeEditor />} />
          <Route path="/remote" element={<RemoteIndex />} />
          <Route path="/remote/:code" element={<Remote />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="footer container">
        <span>WebMCP Anywhere · Recipe Studio</span>
        <span className="muted">Recipes are declarative JSON. No remote code, ever.</span>
      </footer>
    </div>
  );
}
