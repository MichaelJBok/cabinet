import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

export function useSupabase() {
  const [recipes, setRecipes] = useState([]);
  const [selectedMixers, setSelectedMixers] = useState(new Set());
  const [mixerCategories, setMixerCategories] = useState({});
  const [barFilterActive, setBarFilterActive] = useState(false);
  const [dbError, setDbError] = useState(null);
  const [userId, setUserId] = useState(null);

  // ── Auth ─────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ── Load data (re-runs when userId changes) ───────────────
  useEffect(() => {
    if (!userId) return;
    loadAll();
  }, [userId]);

  const loadAll = async () => {
    try {
      // Recipes (shared)
      const { data: recipeRows, error: re } = await supabase
        .from("recipes")
        .select("*")
        .order("id");
      if (re) throw re;

      // Recipe state (per user)
      const { data: stateRows, error: se } = await supabase
        .from("recipe_state")
        .select("*")
        .eq("user_id", userId);
      if (se) throw se;

      // Merge state into recipes
      const stateMap = {};
      (stateRows || []).forEach(s => { stateMap[s.recipe_id] = s; });
      const merged = (recipeRows || []).map(r => ({
        ...r,
        favorite:   stateMap[r.id]?.favorite   ?? false,
        verified:   stateMap[r.id]?.verified   ?? false,
        wantToTry:  stateMap[r.id]?.want_to_try ?? false,
        notes:      stateMap[r.id]?.notes       ?? "",
      }));
      setRecipes(merged);

      // Bar state (per user)
      const { data: barRows, error: be } = await supabase
        .from("bar_state")
        .select("*")
        .eq("user_id", userId);
      if (be) throw be;

      const barRow = (barRows || []).find(b => b.key === "selected_mixers");
      if (barRow?.value) {
        try { setSelectedMixers(new Set(JSON.parse(barRow.value))); } catch {}
      }
      const activeRow = (barRows || []).find(b => b.key === "bar_filter_active");
      if (activeRow?.value) {
        try { setBarFilterActive(JSON.parse(activeRow.value)); } catch {}
      }

      // Mixers (shared)
      const { data: mixerRows, error: me } = await supabase
        .from("mixers")
        .select("*");
      if (me) throw me;
      const cats = {};
      (mixerRows || []).forEach(m => {
        if (!cats[m.category]) cats[m.category] = [];
        cats[m.category].push(m.name);
      });
      setMixerCategories(cats);

    } catch (err) {
      setDbError(err.message);
    }
  };

  // ── Profile ───────────────────────────────────────────────
  const getProfile = async () => {
    if (!userId) return null;
    const { data } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();
    return data?.display_name ?? null;
  };

  const saveProfile = async (displayName) => {
    if (!userId) return;
    await supabase.from("profiles").upsert({
      id: userId,
      display_name: displayName,
    });
  };

  // ── Recipes ───────────────────────────────────────────────
  const createRecipe = async (recipe) => {
    const { error } = await supabase.from("recipes").insert([recipe]);
    if (error) setDbError(error.message);
  };

  const updateRecipe = async (recipe) => {
    const { error } = await supabase
      .from("recipes")
      .upsert([recipe]);
    if (error) setDbError(error.message);
  };

  const deleteRecipe = async (id) => {
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) setDbError(error.message);
  };

  // ── Recipe state ──────────────────────────────────────────
  const saveRecipeState = async (recipeId, patch) => {
    if (!userId) return;
    const { error } = await supabase.from("recipe_state").upsert({
      recipe_id: recipeId,
      user_id:   userId,
      ...patch,
    });
    if (error) setDbError(error.message);
  };

  const toggleFavoriteDB    = (id, val) => saveRecipeState(id, { favorite: val });
  const toggleVerifiedDB    = (id, val) => saveRecipeState(id, { verified: val });
  const toggleWantToTryDB   = (id, val) => saveRecipeState(id, { want_to_try: val });
  const saveNotesDB         = (id, notes) => saveRecipeState(id, { notes });

  // ── Bar state ─────────────────────────────────────────────
  const saveBarState = async (key, value) => {
    if (!userId) return;
    const { error } = await supabase.from("bar_state").upsert({
      key,
      user_id: userId,
      value: JSON.stringify(value),
    });
    if (error) setDbError(error.message);
  };

  const saveSelectedMixers = useCallback(
    (mixers) => saveBarState("selected_mixers", [...mixers]),
    [userId]
  );

  const saveBarFilterActive = useCallback(
    (val) => saveBarState("bar_filter_active", val),
    [userId]
  );

  // ── Mixers ────────────────────────────────────────────────
  const addMixer = async (name, category) => {
    const { error } = await supabase
      .from("mixers")
      .upsert([{ name, category }]);
    if (error) setDbError(error.message);
    setMixerCategories(prev => {
      const next = { ...prev };
      if (!next[category]) next[category] = [];
      if (!next[category].includes(name)) next[category] = [...next[category], name];
      return next;
    });
  };

  // ── Sign out ──────────────────────────────────────────────
  const signOut = async () => {
    await supabase.auth.signOut();
    setRecipes([]);
    setSelectedMixers(new Set());
    setUserId(null);
  };

  return {
    recipes, setRecipes,
    selectedMixers, setSelectedMixers,
    mixerCategories,
    barFilterActive, setBarFilterActive,
    dbError, setDbError,
    userId,
    getProfile, saveProfile,
    createRecipe, updateRecipe,
    deleteRecipe,
    toggleFavoriteDB, toggleVerifiedDB, toggleWantToTryDB, saveNotesDB,
    saveSelectedMixers, saveBarFilterActive,
    addMixer,
    signOut,
    reload: loadAll,
  };
}
