import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { INITIAL_RECIPES, INITIAL_ALL_MIXERS, INITIAL_MIXER_CATEGORIES } from "../data";

// Debounce helper — avoids hammering Supabase on rapid state changes
function useDebouncedCallback(fn, delay) {
  const timer = useRef(null);
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

export function useSupabase() {
  const [recipes, setRecipesRaw] = useState([]);
  const [mixerCategories, setMixerCategories] = useState(INITIAL_MIXER_CATEGORIES);
  const [allMixers, setAllMixers] = useState(INITIAL_ALL_MIXERS);
  const [selectedMixers, setSelectedMixersRaw] = useState(new Set());
  const [lightMode, setLightModeRaw] = useState(false);
  const [filterMode, setFilterModeRaw] = useState("any");
  const [sortOrder, setSortOrderRaw] = useState("match");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Initial load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        // Load recipes + states in parallel
        const [{ data: recipeRows, error: rErr }, { data: stateRows, error: sErr }, { data: barRows, error: bErr }, { data: mixerRows, error: mErr }] = await Promise.all([
          supabase.from("recipes").select("*").order("id"),
          supabase.from("recipe_state").select("*"),
          supabase.from("bar_state").select("*"),
          supabase.from("mixers").select("*").order("category").order("name"),
        ]);

        if (rErr) throw rErr;
        if (sErr) throw sErr;
        if (bErr) throw bErr;
        if (mErr) throw mErr;

        // Merge recipe rows with state rows
        const stateMap = {};
        (stateRows || []).forEach(s => { stateMap[s.recipe_id] = s; });

        const merged = (recipeRows || []).map(r => ({
          id: r.id,
          name: r.name,
          tags: r.tags || [],
          glass: r.glass,
          garnish: r.garnish,
          color: r.color,
          instructions: r.instructions,
          ingredients: r.ingredients || [],
          variantOf: r.variant_of,
          variantName: r.variant_name,
          visual: r.visual || null,
          // user state
          favorite:   stateMap[r.id]?.favorite   ?? false,
          verified:   stateMap[r.id]?.verified   ?? false,
          wantToTry:  stateMap[r.id]?.want_to_try ?? false,
          notes:      stateMap[r.id]?.notes       ?? "",
        }));

        setRecipesRaw(merged.length > 0 ? merged : INITIAL_RECIPES);

        // Bar state — values stored as JSON-encoded strings, decode on read
        const barMap = {};
        (barRows || []).forEach(b => {
          try { barMap[b.key] = JSON.parse(b.value); } catch { barMap[b.key] = b.value; }
        });
        if (barMap.selected_mixers) setSelectedMixersRaw(new Set(barMap.selected_mixers));
        if (barMap.light_mode !== undefined) setLightModeRaw(barMap.light_mode);
        if (barMap.filter_mode) setFilterModeRaw(barMap.filter_mode);
        if (barMap.sort_order) setSortOrderRaw(barMap.sort_order);

        // Mixer catalogue
        if (mixerRows && mixerRows.length > 0) {
          setAllMixers([...new Set(mixerRows.map(m => m.name))]);
          const cats = {};
          mixerRows.forEach(m => {
            if (!cats[m.category]) cats[m.category] = [];
            if (!cats[m.category].includes(m.name)) cats[m.category].push(m.name);
          });
          setMixerCategories(cats);
        }
      } catch (err) {
        console.error("Supabase load error:", err);
        setError(err.message);
        // Fall back to local defaults so the app still works
        setRecipesRaw(INITIAL_RECIPES);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Recipe state writes ───────────────────────────────────────────────────────
  const saveRecipeState = useCallback(async (recipeId, patch) => {
    const { error } = await supabase.from("recipe_state").upsert({
      recipe_id:   recipeId,
      favorite:    patch.favorite,
      verified:    patch.verified,
      want_to_try: patch.wantToTry,
      notes:       patch.notes,
      updated_at:  new Date().toISOString(),
    }, { onConflict: "recipe_id" });
    if (error) console.error("saveRecipeState:", error);
  }, []);

  // Wrapped setRecipes that also persists state changes
  const setRecipes = useCallback((updater) => {
    setRecipesRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Diff and persist any changed recipe states
      next.forEach(r => {
        const old = prev.find(p => p.id === r.id);
        if (!old) return;
        if (old.favorite !== r.favorite || old.verified !== r.verified ||
            old.wantToTry !== r.wantToTry || old.notes !== r.notes) {
          saveRecipeState(r.id, r);
        }
      });
      return next;
    });
  }, [saveRecipeState]);

  // Recipe CRUD (custom recipes created in-app)
  const createRecipe = useCallback(async (recipe) => {
    const { data, error } = await supabase.from("recipes").insert({
      id:           recipe.id,
      name:         recipe.name,
      tags:         recipe.tags,
      glass:        recipe.glass,
      garnish:      recipe.garnish,
      color:        recipe.color,
      instructions: recipe.instructions,
      ingredients:  recipe.ingredients,
      variant_of:   recipe.variantOf || null,
      variant_name: recipe.variantName || null,
    }).select().single();
    if (error) { console.error("createRecipe:", error); return null; }
    return data;
  }, []);

  const updateRecipe = useCallback(async (recipe) => {
    const { error } = await supabase.from("recipes").update({
      name:         recipe.name,
      tags:         recipe.tags,
      glass:        recipe.glass,
      garnish:      recipe.garnish,
      color:        recipe.color,
      instructions: recipe.instructions,
      ingredients:  recipe.ingredients,
      variant_of:   recipe.variantOf || null,
      variant_name: recipe.variantName || null,
    }).eq("id", recipe.id);
    if (error) console.error("updateRecipe:", error);
  }, []);

  const deleteRecipe = useCallback(async (id) => {
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) console.error("deleteRecipe:", error);
  }, []);

  // ── Bar state writes (debounced — fires rapidly on checkbox clicks) ──────────
  const persistBarKey = useCallback(async (key, value) => {
    // supabase-js drops boolean `false` as null for jsonb columns.
    // Workaround: store as a JSON-encoded string, then decode on read.
    const encoded = JSON.stringify(value);
    const { error } = await supabase.from("bar_state").upsert(
      { key, value: encoded, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    if (error) console.error("persistBarKey:", error);
  }, []);

  const debouncedPersistMixers = useDebouncedCallback(
    (set) => persistBarKey("selected_mixers", [...set]),
    800
  );

  const setSelectedMixers = useCallback((updater) => {
    setSelectedMixersRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      debouncedPersistMixers(next);
      return next;
    });
  }, [debouncedPersistMixers]);

  const setLightMode = useCallback((val) => {
    setLightModeRaw(val);
    persistBarKey("light_mode", val);
  }, [persistBarKey]);

  const setFilterMode = useCallback((val) => {
    setFilterModeRaw(val);
    persistBarKey("filter_mode", val);
  }, [persistBarKey]);

  const setSortOrder = useCallback((val) => {
    setSortOrderRaw(val);
    persistBarKey("sort_order", val);
  }, [persistBarKey]);

  // ── Mixer catalogue writes ────────────────────────────────────────────────────
  const addMixer = useCallback(async (name, category) => {
    const { error } = await supabase.from("mixers").upsert({ name, category }, { onConflict: "name" });
    if (error) console.error("addMixer:", error);
    setAllMixers(prev => prev.includes(name) ? prev : [...prev, name]);
    setMixerCategories(prev => ({
      ...prev,
      [category]: [...(prev[category] || []), name],
    }));
  }, []);

  // ── Reset ─────────────────────────────────────────────────────────────────────
  const resetAll = useCallback(async () => {
    await Promise.all([
      supabase.from("recipe_state").delete().neq("recipe_id", 0),
      supabase.from("bar_state").delete().neq("key", "____"),
    ]);
    setRecipesRaw(INITIAL_RECIPES);
    setSelectedMixersRaw(new Set());
    setLightModeRaw(false);
    setFilterModeRaw("any");
    setSortOrderRaw("match");
  }, []);

  return {
    // data
    recipes, setRecipes,
    allMixers, setAllMixers,
    mixerCategories, setMixerCategories,
    selectedMixers, setSelectedMixers,
    lightMode, setLightMode,
    filterMode, setFilterMode,
    sortOrder, setSortOrder,
    // crud
    createRecipe, updateRecipe, deleteRecipe,
    addMixer,
    resetAll,
    // meta
    loading, error,
  };
}
