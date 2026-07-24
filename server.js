import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// StarIO.Online endpoint for your printer
const STAR_ENDPOINT = "https://api.stario.online/v1/a/CASHNDASH/d/bcb6e3f3/q";

// Your StarIO.Online API Key (set this in Render env vars)
const STAR_API_KEY = process.env.STAR_API_KEY;

app.get("/", (req, res) => {
  res.send("Cash N Dash Webhook Running");
});

// MAIN PRINT ENDPOINT FOR VAPI TOOL CALLS
app.post("/print", async (req, res) => {
  let toolCallId = undefined;

  try {
    // Vapi tool-calls payload: req.body.message.toolCallList[]
    const toolCall = req.body?.message?.toolCallList?.[0];
    if (!toolCall) {
      return res.status(400).json({
        ok: false,
        error: "No tool call found in request body at message.toolCallList[0]"
      });
    }

    toolCallId = toolCall.id;

    // Vapi may send function.arguments as a STRINGIFIED JSON or as an object.
    const args =
      typeof toolCall.function?.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function?.arguments;

    const markup = args?.markup;
    if (!markup || typeof markup !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Missing or invalid markup",
        results: [{ toolCallId, result: "missing_markup" }]
      });
    }

    // Build StarXpand payload: print text then cut
    const starXpandPayload = {
      commands: [
        {
          type: "text",
          content: markup + "\n\n"
        },
        {
          type: "cut",
          style: "full" // "partial" is also an option depending on your setup
        }
      ]
    };

    // Send to StarIO.Online
    const starResp = await fetch(STAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Star-Api-Key": STAR_API_KEY
      },
      body: JSON.stringify(starXpandPayload)
    });

    const starText = await starResp.text();

    // IMPORTANT: Don't claim "printed" if StarIO.Online returned an error
    if (!starResp.ok) {
      return res.status(502).json({
        ok: false,
        error: `StarIO.Online error: ${starResp.status}`,
        starResponse: starText,
        results: [{ toolCallId, result: `star_error_${starResp.status}` }]
      });
    }

    // REQUIRED: return tool result so Vapi knows it succeeded
    return res.json({
      ok: true,
      results: [{ toolCallId, result: "printed" }],
      starResponse: starText
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      results: toolCallId ? [{ toolCallId, result: "server_error" }] : []
    });
  }
});

// Start server
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Webhook running on port ${port}`));
