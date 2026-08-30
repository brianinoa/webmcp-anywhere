import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Recipe, RecipeTool } from "@webmcp-anywhere/shared";
import { api, ApiError, notifyRecipesChanged } from "../api";
import { ChipInput } from "../components/ChipInput";
import { ToolEditor } from "../components/ToolEditor";
import { RECIPE_FORMAT_REFERENCE } from "../format";
import { emptyRecipe, emptyTool, isMatchPattern, validateRecipe } from "../validate";

type Tab = "form" | "json";

export function RecipeEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();

  const [recipe, setRecipe] = useState<Recipe | null>(isNew ? emptyRecipe() : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  // Remount tool editors when the JSON tab rewrites the recipe wholesale.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (isNew) return;
    api.get(id).then(setRecipe).catch((e: Error) => setLoadError(e.message));
  }, [id, isNew]);

  const errors = useMemo(() => (recipe ? validateRecipe({ ...recipe, id: recipe.id || undefined }) : []), [recipe]);

  const switchTab = (next: Tab) => {
    if (!recipe) return;
    if (next === "json") {
      setJsonText(JSON.stringify(recipe, null, 2));
      setJsonError(null);
    } else if (jsonError) {
      return; // don't leave the JSON tab with a broken document
    }
    setTab(next);
  };

  const onJson = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text) as Recipe;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("must be an object");
      setJsonError(null);
      setRecipe({ ...emptyRecipe(), ...parsed, id: isNew ? (parsed.id ?? "") : id! });
      setFormKey((k) => k + 1);
    } catch (e) {
      setJsonError(`Invalid JSON: ${(e as Error).message}`);
    }
  };

  const set = (patch: Partial<Recipe>) => setRecipe((r) => (r ? { ...r, ...patch } : r));
  const setTools = (tools: RecipeTool[]) => set({ tools });

  const save = async () => {
    if (!recipe || errors.length || jsonError) return;
    setSaving(true);
    setServerErrors([]);
    try {
      const body = { ...recipe, id: recipe.id || undefined } as Recipe;
      const saved = isNew ? await api.create(body) : await api.update(id!, body);
      notifyRecipesChanged();
      navigate(`/recipes/${encodeURIComponent(saved.id)}`);
    } catch (e) {
      setServerErrors(e instanceof ApiError && e.errors.length ? e.errors : [(e as Error).message]);
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="empty-state">
        <h2>Recipe not found</h2>
        <p className="muted">{loadError}</p>
        <Link to="/" className="btn">
          Back to recipes
        </Link>
      </div>
    );
  }
  if (!recipe) return <p className="muted">Loading…</p>;

  const allErrors = [...errors, ...serverErrors];

  return (
    <div className="editor">
      <nav className="crumbs">
        <Link to="/">Recipes</Link> /{" "}
        {isNew ? <span>New recipe</span> : (
          <>
            <Link to={`/recipes/${encodeURIComponent(id!)}`}>{recipe.name || id}</Link> / <span>Edit</span>
          </>
        )}
      </nav>

      <header className="editor-head">
        <h1>{isNew ? "New recipe" : `Edit ${recipe.name}`}</h1>
        <div className="editor-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setShowHelp(!showHelp)}>
            {showHelp ? "Hide format reference" : "Format reference"}
          </button>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "form"} className={tab === "form" ? "active" : ""} onClick={() => switchTab("form")}>
              Form
            </button>
            <button type="button" role="tab" aria-selected={tab === "json"} className={tab === "json" ? "active" : ""} onClick={() => switchTab("json")}>
              JSON
            </button>
          </div>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || errors.length > 0 || Boolean(jsonError)}>
            {saving ? "Saving…" : isNew ? "Create recipe" : "Save changes"}
          </button>
        </div>
      </header>

      {showHelp && <pre className="code help">{RECIPE_FORMAT_REFERENCE}</pre>}

      {allErrors.length > 0 && (
        <div className="alert">
          <strong>{allErrors.length === 1 ? "1 problem" : `${allErrors.length} problems`}</strong>
          <ul>
            {allErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {tab === "json" ? (
        <div className="json-tab">
          <textarea className="mono json-editor" value={jsonText} onChange={(e) => onJson(e.target.value)} spellCheck={false} rows={30} />
          {jsonError && <p className="field-error">{jsonError}</p>}
          <p className="muted small">Edits here round-trip with the form.</p>
        </div>
      ) : (
        <form key={formKey} className="editor-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <section className="card">
            <div className="grid-2">
              <label className="field">
                <span>Name</span>
                <input value={recipe.name} placeholder="YouTube" onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
              </label>
              <label className="field">
                <span>Id {isNew && <span className="muted">(optional; generated from name)</span>}</span>
                <input value={recipe.id} placeholder="youtube" disabled={!isNew} onChange={(e) => set({ id: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Description</span>
              <textarea rows={2} value={recipe.description} placeholder="Search, play, and control YouTube videos." onChange={(e) => set({ description: e.target.value })} />
            </label>
            <label className="field" htmlFor="matches">
              <span>Match patterns (press Enter to add; e.g. *://*.youtube.com/*)</span>
            </label>
            <ChipInput id="matches" values={recipe.matches} onChange={(matches) => set({ matches })} placeholder="*://*.example.com/*" validate={isMatchPattern} />
            <div className="grid-2">
              <label className="field">
                <span>Author (optional)</span>
                <input value={recipe.author ?? ""} onChange={(e) => set({ author: e.target.value || undefined })} />
              </label>
              <label className="field field-sm">
                <span>Version</span>
                <input type="number" min={0} value={recipe.version} onChange={(e) => set({ version: Number(e.target.value) })} />
              </label>
            </div>
          </section>

          <div className="tools-head">
            <h2>
              Tools <span className="pill">{recipe.tools.length}</span>
            </h2>
            <button type="button" className="btn btn-sm" onClick={() => setTools([...recipe.tools, emptyTool()])}>
              Add tool
            </button>
          </div>
          <div className="stack">
            {recipe.tools.map((t, i) => (
              <ToolEditor
                key={i}
                tool={t}
                index={i}
                onChange={(next) => setTools(recipe.tools.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setTools(recipe.tools.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </form>
      )}
    </div>
  );
}
