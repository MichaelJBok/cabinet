export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "No name provided" });

  const prompt = `You are a cocktail expert. Return a JSON object for the cocktail "${name}". Use ONLY this exact structure, no other text:
{
  "name": "${name}",
  "glass": "one of: Rocks, Coupe, Martini, Highball, Flute, Wine, Mule, Hurricane, Shot, Snifter, Tiki, Nick & Nora",
  "garnish": "brief garnish description or empty string",
  "tags": ["1-3 tags from: Classic, Modern Classic, Sour, Spirit Forward, Bitter, Highball, Tropical, Creamy, Sparkling, Low-ABV, Mocktail"],
  "color": "hex color representing the liquid, e.g. #c8622a for a negroni",
  "instructions": "2-3 sentence method. Start with technique (stir/shake/build). End with glass and garnish.",
  "ingredients": [
    {"name": "ingredient name", "oz": 1.5, "unit": "oz"},
    {"name": "dash ingredient", "oz": null, "unit": "dash", "label": "2 dashes"}
  ]
}
Use null oz + label for dashes/pinches. Use numeric oz for all other ingredients. Be precise with classic recipes.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
