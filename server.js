import express from "express";
import fetch from "node-fetch";

const app = express();

// Vapi sends JSON → MUST parse JSON
app.use(express.json());

// StarIO.Online endpoint for your printer
const STAR_ENDPOINT = "https://api.stario.online/v1/a/CASHNDASH/d/bcb6e3f3/q";

// Your StarIO.Online API Key
const STAR_API_KEY = process.env.STAR_API_KEY;

// MAIN PRINT ENDPOINT FOR VAPI TOOL CALLS
app.post("/print", async (req, res) => {
  try {
    // Extract tool call from Vapi
    const toolCall = req.body?.message?.toolCallList?.[0];

    if (!toolCall) {
      return res.status(400).json({
        ok: false,
        error: "No tool call found in request"
      });
    }

    // Extract markup text from Vapi
    const markup = toolCall.function.arguments.markup;
    const toolCallId = toolCall.id;

    // Convert markup into StarXpand JSON commands
    const starXpandPayload = {
      commands: [
        {
          type: "text",
          content: markup + "\n\n"
        },
        {
          type: "cut",
          style: "full"
        }
      ]
    };

    // Send JSON commands to StarIO.Online
    const response = await fetch(STAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Star-Api-Key": STAR_API_KEY
      },
      body: JSON.stringify(starXpandPayload)
    });

    const starText = await response.text();

    // REQUIRED: return tool result so Vapi knows it succeeded
    return res.json({
      results: [
        {
          toolCallId,
          result: "printed"
        }
      ],
      starResponse: starText
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// Simple GET endpoint
app.get("/", (req, res) => {
  res.send("Cash N Dash Webhook Running");
});

// Start server
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Webhook running on port ${port}`));
