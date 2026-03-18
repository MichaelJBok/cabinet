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
  "color": "hex color representing the final liquid in the glass — see guide below",
  "instructions": "2-3 sentence method. Start with technique (stir/shake/build). End with glass and garnish.",
  "ingredients": [
    {"name": "Spirit name", "oz": 1.5},
    {"name": "Modifier", "oz": 0.75},
    {"name": "Angostura Bitters", "oz": null, "label": "2 dashes"},
    {"name": "Absinthe", "oz": null, "label": "rinse"}
  ]
}

COLOR GUIDE — pick the hex that best matches the finished drink's appearance:
- Whiskey/bourbon neat or stirred (Manhattan, Old Fashioned): #c87820 to #a05010
- Rum-forward (dark rum dominant): #8b4010
- Aged spirit + vermouth (Boulevardier, Toronto): #c0622a
- Campari/Aperol drinks (Negroni, Aperol Spritz): #e8442a or #f07030
- Gin/vodka + citrus, shaken cloudy (Gimlet, Daiquiri, Cosmopolitan): #f5f0d8 to #fffde7
- Gin/vodka clear, stirred (Martini, Gibson): #e8f4f8
- Green/herbal (Last Word, Grasshopper, Midori): #90c840 to #60a830
- Blue/purple (Aviation, Blue Lagoon): #8090e0 or #c060d0
- Pink/rose (Clover Club, Aperol-based, rosé): #f0a0b0 to #e87890
- Tropical/yellow (Mai Tai, Jungle Bird, Painkiller): #f0a830 to #e8c040
- Deep red/burgundy (New York Sour, sangria): #901830
- Cream/white/frothy (Ramos Gin Fizz, White Russian, egg white drinks): #f5f0e8
- Coffee/dark (Espresso Martini, Black Russian): #2a1a08
- Citrus-forward sours, shaken with egg white: slightly cloudy version of base spirit color
- Sparkling/light (French 75, Kir Royale): #f8f0e0 or #f5e8f0

Think carefully about what the drink actually looks like in a glass. Campari turns drinks red-orange. Blue Curacao turns drinks blue. Midori turns drinks green. A shaken drink with citrus goes cloudy/pale. A stirred whiskey drink stays amber.`;

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
