export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "No name provided" });

  const prompt = `You are a cocktail expert. Return a JSON object for the cocktail "${name}". Use ONLY this exact structure, no other text:
{
  "name": "${name}",
  "glass": "one of: Rocks, Coupe, Martini, Highball, Flute, Wine, Mule, Hurricane, Shot, Snifter, Tiki, Nick & Nora",
  "garnish": "brief garnish description e.g. 'Orange peel', 'Lime wheel', 'Cherry', or empty string",
  "tags": ["1-3 tags from: Classic, Modern Classic, Sour, Spirit Forward, Bitter, Highball, Tropical, Creamy, Sparkling, Low-ABV, Mocktail"],
  "color": "hex color representing the liquid, e.g. #c8622a for a negroni, #f5e6a0 for a gimlet",
  "instructions": "2-3 sentence method. Start with technique (stir/shake/build). End with glass and garnish.",
  "ingredients": [
    {"name": "Spirit name", "oz": 1.5},
    {"name": "Modifier", "oz": 0.75},
    {"name": "Angostura Bitters", "oz": null, "label": "2 dashes"},
    {"name": "Absinthe", "oz": null, "label": "rinse"}
  ]
}
Rules for ingredients:
- Use "oz" (number) for all measurable liquids
- Use oz: null and a "label" string for dashes (e.g. "2 dashes"), rinses (e.g. "rinse"), pinches, or garnish ingredients
- Do not include a garnish as an ingredient if it is already in the garnish field
- Be precise with classic recipes`;

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
