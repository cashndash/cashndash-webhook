import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// StarIO.Online endpoint for your printer
const STAR_ENDPOINT = "https://api.stario.online/v1/a/CASHNDASH/d/bcb6e3f3/q";
const STAR_API_KEY = process.env.STAR_API_KEY;

if (!STAR_API_KEY) {
  console.warn("WARNING: STAR_API_KEY environment variable is not set.");
}

// Helper to format Eastern Time
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

// Main Vapi Tool Handler Endpoint
app.post("/print", async (req, res) => {
  // Extract tool call metadata immediately to ensure toolCallId is always returned
  const toolCall = req.body?.message?.toolCallList?.[0];
  const toolCallId = toolCall?.id || "fallback_id";
  const toolName = toolCall?.function?.name;

  if (!toolCall) {
    return res.status(200).json({
      results: [{ toolCallId, result: "no_tool_call_in_payload" }]
    });
  }

  try {
    // Safely parse function arguments (handles string or object)
    let args = toolCall.function?.arguments || {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (e) {
        args = { content: args };
      }
    }

    // -------------------------------------------------------------
    // TOOL 1: get_now_et (Returns Eastern Time without printing)
    // -------------------------------------------------------------
    if (toolName === "get_now_et") {
      const now_et = formatNowET();
      return res.status(200).json({
        results: [{ toolCallId, result: { now_et } }]
      });
    }

    // -------------------------------------------------------------
    // TOOL 2: print_star_receipt (Sends formatted order to printer)
    // -------------------------------------------------------------
    if (toolName !== "print_star_receipt") {
      return res.status(200).json({
        results: [{ toolCallId, result: `unknown_tool_${toolName}` }]
      });
    }

    // Capture order content from ANY parameter field Vapi might send
    let rawMarkup = 
      args.markup || 
      args.content || 
      args.text || 
      args.items || 
      args.order_details || 
      args.order;

    if (!rawMarkup && typeof args === "object") {
      rawMarkup = Object.entries(args)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join("\n");
    }

    if (!rawMarkup) {
      return res.status(200).json({
        results: [{ toolCallId, result: "missing_markup" }]
      });
    }

    // Strip redundant store names or duplicate timestamps if Vapi sends them
    rawMarkup = String(rawMarkup)
      .replace(/^Cash N Dash\s*/im, '')
      .replace(/^Timestamp:.*$/im, '')
      .trim();

    const now_et = args.now_et || formatNowET();

    // Clean Receipt Layout in Star Document Markup
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

    // 4-Second Timeout Guard to prevent Vapi connection drops
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(STAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/vnd.star.markup",
        "Star-Api-Key": STAR_API_KEY
      },
      body: formattedMarkup,
      signal: controller.signal
    });

    clearTimeout(timeout);
    const starText = await response.text();

    if (!response.ok) {
      console.error("StarIO Error:", response.status, starText);
      return res.status(200).json({
        results: [{ toolCallId, result: `star_error_${response.status}` }],
        starResponse: starText
      });
    }

    // SUCCESS -> Tell Vapi the ticket printed successfully
    return res.status(200).json({
      results: [{ toolCallId, result: "printed" }],
      starResponse: starText
    });

  } catch (err) {
    console.error("Server Error:", err);
    // Always return HTTP 200 with matching toolCallId even during unexpected errors/timeouts
    return res.status(200).json({
      results: [{ 
        toolCallId, 
        result: err.name === "AbortError" ? "printer_timeout" : "server_error" 
      }],
      error: err?.message || String(err)
    });
  }
});

// Health check endpoint
app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

// Start Webhook Server
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cash N Dash Webhook running on port ${port}`));
