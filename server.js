import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

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

app.post("/print", async (req, res) => {
  const toolCall = req.body?.message?.toolCallList?.[0];
  const toolCallId = toolCall?.id || "fallback_id";
  const toolName = toolCall?.function?.name;

  try {
    if (!toolCall) {
      return res.status(400).json({ error: "No tool call found" });
    }

    // Safely extract arguments
    let args = toolCall.function?.arguments || {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (e) {
        args = { content: args };
      }
    }

    // 1) Tool: get_now_et
    if (toolName === "get_now_et") {
      const now_et = formatNowET();
      return res.json({
        results: [{ toolCallId, result: { now_et } }]
      });
    }

    // 2) Tool: print_star_receipt
    // Capture content from ANY parameter Vapi might send
    let rawMarkup = 
      args.markup || 
      args.content || 
      args.text || 
      args.items || 
      args.order_details || 
      args.order ||
      (typeof args === "string" ? args : null);

    // If args is an object with values, convert values to string if rawMarkup is missing
    if (!rawMarkup && typeof args === "object") {
      rawMarkup = Object.entries(args)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join("\n");
    }

    if (!rawMarkup) {
      return res.json({
        results: [{ toolCallId, result: "missing_markup" }]
      });
    }

    // Clean up duplicate store name or timestamp lines from Vapi
    rawMarkup = String(rawMarkup)
      .replace(/^Cash N Dash\s*/im, '')
      .replace(/^Timestamp:.*$/im, '')
      .trim();

    const now_et = args.now_et || formatNowET();

    // FORMAT RECEIPT
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

    // Send to StarIO
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
      return res.json({
        results: [{ toolCallId, result: `star_error_${response.status}` }],
        starResponse: starText
      });
    }

    // SUCCESS
    return res.json({
      results: [{ toolCallId, result: "printed" }],
      starResponse: starText
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.json({
      results: [{ toolCallId, result: "server_error" }],
      error: err?.message || String(err)
    });
  }
});

app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Webhook running on port ${port}`));
