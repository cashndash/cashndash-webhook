import express from "express";
import fetch from "node-fetch";

const app = express();

// Vapi sends JSON -> MUST parse JSON
app.use(express.json());

// StarIO.Online endpoint for your printer
const STAR_ENDPOINT = "https://api.stario.online/v1/a/CASHNDASH/d/bcb6e3f3/q";

// Your StarIO.Online API Key
const STAR_API_KEY = process.env.STAR_API_KEY;

// MAIN PRINT ENDPOINT FOR VAPI TOOL CALLS
app.post("/print", async (req, res) => {
  let toolCallId = null;

  try {
    const toolCall = req.body?.message?.toolCallList?.[0];

    if (!toolCall) {
      return res.status(400).json({
        error: "No tool call found in request"
      });
    }

    toolCallId = toolCall.id;

    // Parse arguments (string OR object)
    const args =
      typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

    const rawMarkup = args?.markup || args?.text || args?.content;

    if (!rawMarkup) {
      return res.status(400).json({
        results: [{ toolCallId, result: "missing_markup" }]
      });
    }

    // Format template using Star Document Markup commands:
    // [align: center] -> Center alignment
    // [bold: on] -> Enable bold text
    // [mag: w 2; h 2] -> 2x bigger font width & height
    // [cut] -> Auto cut receipt
    const formattedMarkup = 
`[align: center]
[bold: on][mag: w 2; h 2]STORE CASH N DASH[mag][bold: off]

[align: left]
********************************
[bold: on]ORDER DETAILS:[bold: off]
********************************

[bold: on]${rawMarkup}[bold: off]

********************************
[align: center]
THANK YOU FOR YOUR ORDER!
********************************

[cut]`;

    // Send RAW Star Document Markup to StarIO.Online
    const response = await fetch(STAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/vnd.star.markup",
        "Star-Api-Key": STAR_API_KEY
      },
      body: formattedMarkup
    });

    const starText = await response.text();

    // If StarIO failed -> return error to Vapi
    if (!response.ok) {
      console.error("StarIO Error:", response.status, starText);
      return res.status(502).json({
        results: [{ toolCallId, result: `star_error_${response.status}` }],
        starResponse: starText
      });
    }

    // SUCCESS -> Vapi sees "printed"
    return res.json({
      results: [{ toolCallId, result: "printed" }],
      starResponse: starText
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({
      results: [{ toolCallId, result: "server_error" }],
      error: err.message
    });
  }
});

// Simple GET endpoint to verify server status
app.get("/", (req, res) => {
  res.send("Cash N Dash Webhook Running");
});

// Start server
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Webhook running on port ${port}`));
