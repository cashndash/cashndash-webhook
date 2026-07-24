import express from "express";
import fetch from "node-fetch";

const app = express();

// Vapi sends JSON → we MUST parse JSON
app.use(express.json());

// Your StarIO.Online print endpoint
const STAR_ENDPOINT = "https://api.stario.online/v1/a/CASHNDASH/d/bcb6e3f3/q";

// Your StarIO.Online API Key
const STAR_API_KEY = process.env.STAR_API_KEY;

// MAIN PRINT ENDPOINT FOR VAPI TOOL CALLS
app.post("/print", async (req, res) => {
  try {
    // Extract tool call
    const toolCall = req.body?.message?.toolCallList?.[0];

    if (!toolCall) {
      return res.status(400).json({
        ok: false,
        error: "No tool call found in request"
      });
    }

    // Extract markup text
    const markup = toolCall.function.arguments.markup;
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

    const starText = await response.text();

    // REQUIRED: return tool result so Vapi stops complaining
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
