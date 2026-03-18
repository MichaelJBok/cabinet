export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "No name provided" });

  const prompt = `You are a cocktail expert and visual designer. Return a JSON object for the cocktail "${name}". Use ONLY this exact structure, no other text:
{
  "name": "${name}",
  "glass": "one of: Rocks, Coupe, Martini, Highball, Flute, Wine, Mule, Hurricane, Shot, Snifter, Tiki, Nick & Nora",
  "garnish": "brief garnish description e.g. 'Orange peel', 'Lime wheel', 'Cherry', or empty string",
  "tags": ["1-3 tags from: Classic, Modern Classic, Sour, Spirit Forward, Bitter, Highball, Tropical, Creamy, Sparkling, Low-ABV, Mocktail"],
  "color": "hex color — see instructions below",
  "instructions": "2-3 sentence method. Start with technique (stir/shake/build). End with glass and garnish.",
  "ingredients": [
    {"name": "Spirit name", "oz": 1.5},
    {"name": "Modifier", "oz": 0.75},
    {"name": "Angostura Bitters", "oz": null, "label": "2 dashes"},
    {"name": "Absinthe", "oz": null, "label": "rinse"}
  ]
}

COLOR INSTRUCTIONS — this is critical, think carefully:
Step 1: List the dominant colored ingredients and what color they contribute:
- Campari → deep red #c43020
- Aperol → warm orange #d05c28  
- Yellow Chartreuse → yellow-green #bcc830
- Green Chartreuse → herbal green #48a028
- Midori → muted green #68a828
- Blue Curaçao → blue #3060c0
- Crème de Violette → muted purple #7040a0
- Grenadine → red #cc2040
- Falernum → pale yellow #f0e880
- Pineapple juice → golden yellow #f0c030
- Orange juice → orange #f07820
- Lime juice → pale yellow-green (very light, nearly clear)
- Lemon juice → pale yellow (very light, nearly clear)
- Aged rum / bourbon / scotch / brandy → amber #c07820
- Dark rum → dark brown #6b3010
- Coffee liqueur / espresso → near black #1a0a04
- Elderflower liqueur / dry vermouth / gin / vodka / white rum / tequila / mezcal → nearly clear, contributes no color

Step 2: Blend the colors of the dominant ingredients proportionally to get the final drink color. A shaken drink will be slightly lighter/cloudier.

Step 3: Output a realistic hex that matches how the drink actually looks in a glass — slightly muted, not neon or oversaturated. Think of it as how the drink photographs, not a color swatch. Even clear drinks appear as a warm pale yellow (#f0e8c8) due to the glass. Minimum saturation 20%, maximum saturation 70% — avoid pure vivid colors.

Examples:
- Naked and Famous (equal parts mezcal, Yellow Chartreuse, Aperol, lime): Aperol orange + Chartreuse yellow-green = warm coral #c86828
- Negroni (gin, sweet vermouth, Campari): Campari red dominates = #b83020  
- Last Word (equal parts gin, Green Chartreuse, maraschino, lime): Green Chartreuse dominates = #609828
- Paper Plane (equal parts bourbon, Aperol, Amaro Nonino, lemon): Aperol orange + bourbon amber = #c06828
- Jungle Bird (rum, Campari, pineapple, lime, simple): Campari red + pineapple gold = #b04020
- Penicillin (scotch, lemon, honey, ginger): amber honey = #c8901a
- Mai Tai (rum, lime, orgeat, orange curaçao): golden orange = #e8a030`;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Anthropic API error:", JSON.stringify(data));
      return res.status(response.status).json({ error: data?.error?.message || JSON.stringify(data) });
    }
    res.json(data);
  } catch (e) {
    console.error("autofill exception:", e.message);
    res.status(500).json({ error: e.message });
  }
}
