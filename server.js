import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// StarIO.Online endpoint for your printer
const STAR_ENDPOINT = "https://api.stario.online/v1/a/CASHNDASH/d/bcb6e3f3/q";
const STAR_API_KEY = process.env.STAR_API_KEY;

if (!STAR_API_KEY) {
  console.warn("WARNING: STAR_API_KEY is not set.");
}

function formatNowET() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(now);
}

// Vapi Tool Calls endpoint (handles BOTH tools)
app.post("/print", async (req, res) => {
  try {
    const toolCall = req.body?.message?.toolCallList?.[0];
    if (!toolCall) {
      return res.status(400).json({ error: "No tool call found in request" });
    }

    const toolCallId = toolCall.id;
    const toolName = toolCall.function?.name;

    // Parse arguments (string OR object)
    const args =
      typeof toolCall.function?.arguments === "string"
        ? JSON.parse(toolCall.function.arguments || "{}")
        : toolCall.function?.arguments || {};

    // 1) Tool: get_now_et
    if (toolName === "get_now_et") {
      const now_et = formatNowET();
      return res.json({
        results: [{ toolCallId, result: { now_et } }]
      });
    }

    // 2) Tool: print_star_receipt
    if (toolName !== "print_star_receipt") {
      return res.status(400).json({
        results: [{ toolCallId, result: `unknown_tool_${toolName}` }]
      });
    }

    const rawMarkup = args?.markup || args?.text || args?.content;
    if (!rawMarkup) {
      return res.status(400).json({
        results: [{ toolCallId, result: "missing_markup" }]
      });
    }

    const now_et = args?.now_et || formatNowET();

    // FIXED STAR MARKUP TEMPLATE
    // Removed broken [mag] tag at the bottom that was blocking the [cut] command
    const formattedMarkup = 
`[align: center]
[bold: on][mag: w 2; h 2]Cash N Dash[mag][bold: off]

[mag: w 1; h 1]   512 WILLOW ST       
   VINCENNES, IN 47591
   812-882-6102        

${now_et} ET

[align: left]
--------------------------------
[bold: on][mag: w 1; h 2]ORDER DETAILS[mag][bold: off]
--------------------------------

[bold: on][mag: w 1; h 2]${rawMarkup}[mag][bold: off]

--------------------------------
[align: center]
[mag: w 1; h 1]THANK YOU!

[cut]`;

    const response = await fetch(STAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/vnd.star.markup",
        "Star-Api-Key": STAR_API_KEY
      },
      body: formattedMarkup
    });

    const starText = await response.text();

    if (!response.ok) {
      console.error("StarIO Error:", response.status, starText);
      return res.status(502).json({
        results: [{ toolCallId, result: `star_error_${response.status}` }],
        starResponse: starText
      });
    }

    return res.json({
      results: [{ toolCallId, result: "printed" }],
      starResponse: starText
    });
  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({
      results: [
        { toolCallId: req.body?.message?.toolCallList?.[0]?.id, result: "server_error" }
      ],
      error: err?.message || String(err)
    });
  }
});

// Health check
app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Webhook running on port ${port}`));
