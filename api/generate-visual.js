export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).end();
    const { name, glass, color, garnish, ingredients } = req.body;
    if (!name) return res.status(400).json({ error: "No name provided" });
    const ingredientList = (ingredients || []).map(i => i.name).join(", ");
    const prompt = `You are a cocktail visual designer. Given this cocktail, return a JSON object for its SVG illustration. Return ONLY valid JSON, no other text.
    Cocktail: "${name}"
    Glass: "${glass || "rocks"}"
    Color: "${color || "#c8a060"}"
    Garnish description: "${garnish || "none"}"
    Ingredients: ${ingredientList || "unknown"}
    Return exactly:
    {"glass":"rocks|martini|highball|flute|wine|mule|hurricane|shot|snifter|nick|tiki","liquid":"${color || "#c8a060"}","foam":false,"garnish":null,"ice":false,"bigice":false,"bubbles":false,"crushed":false,"layered":false,"salt":false,"sugar":false}
    RULES - glass: rocks=Rocks/OldFashioned/Lowball, nick=Coupe/Nick&Nora, martini=Martini, highball=Highball/Collins, flute=Flute/Champagne, wine=Wine/Goblet, mule=Mule/CopperMug, hurricane=Hurricane, shot=Shot/Shooter, snifter=Snifter/Brandy, tiki=Tiki. liquid: use the provided hex exactly. foam: true only if egg white/aquafaba/cream shaken. garnish: map to null OR one of: orange_peel,lime_wheel,lemon_wheel,cherry,mint,olive,cucumber,grapefruit_wheel,pineapple_wedge,strawberry,lime_wedge,lemon_wedge,dehydrated_citrus. orange_peel/twist=orange_peel. lime_wheel/round=lime_wheel. lime_wedge=lime_wedge. lemon_wheel=lemon_wheel. lemon_wedge=lemon_wedge. cherry/luxardo=cherry. mint_sprig=mint. olive=olive. cucumber=cucumber. grapefruit=grapefruit_wheel. pineapple=pineapple_wedge. strawberry=strawberry. dehydrated=dehydrated_citrus. unusual/flower/none=null. ice: true if served over ice cubes. bigice: true for spirit-forward rocks drinks (Old Fashioned, Negroni, etc) with single large cube, overrides ice. bubbles: true if carbonated (tonic/soda/ginger beer/champagne/prosecco). crushed: true only for Julep/Caipirinha/Swizzles. layered: true only for dramatic gradient (Tequila Sunrise). salt: true if salted rim. sugar: true if sugared rim.`;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });
    try {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
                  body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
          });
          const data = await response.json();
          if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || JSON.stringify(data) });
          const text = data.content?.[0]?.text || "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return res.status(500).json({ error: "No JSON in response" });
          const vis = JSON.parse(jsonMatch[0]);
          res.json({ vis });
    } catch (e) {
          res.status(500).json({ error: e.message });
    }
}
