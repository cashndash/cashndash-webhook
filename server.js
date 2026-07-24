
app.post("/print", async (req, res) => {
  try {
    // Vapi sends JSON, not raw text
    const toolCall = req.body?.message?.toolCallList?.[0];

    if (!toolCall) {
      return res.status(400).json({ ok: false, error: "No tool call found" });
    }

    const markup = toolCall.function.arguments.markup;   // <-- THIS is the receipt text
    const toolCallId = toolCall.id;

    // Send ONLY the markup to StarIO.Online
    const response = await fetch(STAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/vnd.star.markup",
        "Star-Api-Key": STAR_API_KEY
      },
      body: markup
    });

    const text = await response.text();

    // MUST return this so Vapi stops complaining
    return res.json({
      results: [
        {
          toolCallId,
          result: "printed"
        }
      ],
      starResponse: text
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
