import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";

export function useSupabase() {
  const [recipes, setRecipes] = useState([]);
  const [selectedMixers, setSelectedMixers] = useState(new Set());
  const [mixerCategories, setMixerCategories] = useState({});
  const [barFilterActive, setBarFilterActive] = useState(false);
  const [dbError, setDbError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userEmail, setUserEmail] = useState(null);

  // Local-only state
  const [filterMode, setFilterMode] = useState("any");
  const [sortOrder, setSortOrder] = useState("match");

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
      setUserEmail(data.session?.user?.email ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
      setUserEmail(session?.user?.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;
    loadAll();
  }, [userId]);

  const loadAll = async () => {
    try {
      const { data: recipeRows, error: re } = await supabase.from("recipes").select("*").order("id");
      if (re) throw re;

      const { data: stateRows, error: se } = await supabase.from("recipe_state").select("*").eq("user_id", userId);
      if (se) throw se;

      const stateMap = {};
      (stateRows || []).forEach(s => { stateMap[s.recipe_id] = s; });
      const merged = (recipeRows || [])
        .filter(r => stateMap[r.id]?.notes !== "__hidden__") // filter user-hidden recipes
        .map(r => ({
          ...r,
          variantOf:   r.variant_of   ?? r.variantOf   ?? null,
          variantName: r.variant_name ?? r.variantName ?? "",
          favorite:    stateMap[r.id]?.favorite    ?? false,
          verified:    stateMap[r.id]?.verified    ?? false,
          wantToTry:   stateMap[r.id]?.want_to_try ?? false,
          notes:       stateMap[r.id]?.notes       ?? "",
        }));
      setRecipes(merged);

      const { data: barRows, error: be } = await supabase.from("bar_state").select("*").eq("user_id", userId);
      if (be) throw be;

      const barRow = (barRows || []).find(b => b.key === "selected_mixers");
      if (barRow?.value) { try { setSelectedMixers(new Set(JSON.parse(barRow.value))); } catch {} }
      const activeRow = (barRows || []).find(b => b.key === "bar_filter_active");
      if (activeRow?.value) { try { setBarFilterActive(JSON.parse(activeRow.value)); } catch {} }

      const { data: mixerRows, error: me } = await supabase.from("mixers").select("*");
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

  const allMixers = useMemo(() => Object.values(mixerCategories).flat(), [mixerCategories]);

  const getProfile = async () => {
    if (!userId) return null;
    const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).single();
    return data?.display_name ?? null;
  };

  const saveProfile = async (displayName) => {
    if (!userId) return;
    await supabase.from("profiles").upsert({ id: userId, display_name: displayName });
  };

  // Convert camelCase app fields to snake_case DB columns
  const toDbRecipe = (recipe) => {
    // Strip camelCase/app-only fields, map to snake_case DB columns
    const { variantOf, variantName, wantToTry, favorite, verified, notes, _variantSearch, ...rest } = recipe;
    return {
      ...rest,
      variant_of:   variantOf   ?? null,
      variant_name: variantName ?? "",
    };
  };

  const createRecipe = async (recipe) => {
    const { data, error } = await supabase.from("recipes").insert([toDbRecipe(recipe)]).select();
    if (error) setDbError(error.message);
    return data ? data[0] : null;
  };

  const updateRecipe = async (recipe) => {
    const { error } = await supabase.from("recipes").upsert([toDbRecipe(recipe)]);
    if (error) setDbError(error.message);
  };

  const deleteRecipe = async (id) => {
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) setDbError(error.message);
  };

  const saveRecipeState = async (recipeId, patch) => {
    if (!userId) return;
    const { error } = await supabase.from("recipe_state").upsert({ recipe_id: recipeId, user_id: userId, ...patch });
    if (error) setDbError(error.message);
  };

  const toggleFavoriteDB  = (id, val) => saveRecipeState(id, { favorite: val });
  const toggleVerifiedDB  = (id, val) => saveRecipeState(id, { verified: val });
  const toggleWantToTryDB = (id, val) => saveRecipeState(id, { want_to_try: val });
  const saveNotesDB       = (id, notes) => saveRecipeState(id, { notes });

  const saveBarState = useCallback(async (key, value) => {
    if (!userId) return;
    const { error } = await supabase.from("bar_state").upsert({ key, user_id: userId, value: JSON.stringify(value) });
    if (error) setDbError(error.message);
  }, [userId]);

  const saveSelectedMixers = useCallback((mixers) => saveBarState("selected_mixers", [...mixers]), [saveBarState]);
  const saveBarFilterActive = useCallback((val) => saveBarState("bar_filter_active", val), [saveBarState]);

  const addMixer = async (name, category) => {
    const { error } = await supabase.from("mixers").upsert([{ name, category }]);
    if (error) setDbError(error.message);
    setMixerCategories(prev => {
      const next = { ...prev };
      if (!next[category]) next[category] = [];
      if (!next[category].includes(name)) next[category] = [...next[category], name];
      return next;
    });
  };

  const resetAll = async () => {
    if (!userId) return;
    await supabase.from("recipe_state").delete().eq("user_id", userId);
    await supabase.from("bar_state").delete().eq("user_id", userId);
    setSelectedMixers(new Set());
    setBarFilterActive(false);
    setRecipes(prev => prev.map(r => ({ ...r, favorite: false, verified: false, wantToTry: false, notes: "" })));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRecipes([]);
    setSelectedMixers(new Set());
    setUserId(null);
  };

  return {
    recipes, setRecipes,
    allMixers,
    selectedMixers, setSelectedMixers,
    mixerCategories, setMixerCategories,
    barFilterActive, setBarFilterActive,
    filterMode, setFilterMode,
    sortOrder, setSortOrder,
    dbError, setDbError,
    userId, userEmail,
    getProfile, saveProfile,
    createRecipe, updateRecipe,
    deleteRecipe,
    toggleFavoriteDB, toggleVerifiedDB, toggleWantToTryDB, saveNotesDB, saveRecipeState,
    saveSelectedMixers, saveBarFilterActive,
    addMixer,
    resetAll,
    signOut,
    reload: loadAll,
  };
}
