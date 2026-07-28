import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// StarIO.Online endpoint for your printer
const STAR_ENDPOINT = "https://api.stario.online/v1/a/CASHNDASH/d/4cfe6e42/q";
const STAR_API_KEY = process.env.STAR_API_KEY;

if (!STAR_API_KEY) {
  console.warn("WARNING: STAR_API_KEY environment variable is not set.");
}

// Helper function to format Eastern Time
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

// Main Endpoint Handling Vapi Tool Calls
app.post("/print", async (req, res) => {
  const toolCallList = req.body?.message?.toolCallList || [];

  // If Vapi didn't send tool calls, respond 200 with empty results.
  if (!Array.isArray(toolCallList) || toolCallList.length === 0) {
    return res.status(200).json({ results: [] });
  }

  const results = [];

  for (const tc of toolCallList) {
    const toolCallId = tc.id;
    const toolName = tc.function?.name;

    // Parse args safely
    let args = tc.function?.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = { markup: args };
      }
    }

    try {
      // 1) Tool: get_now_et
      if (toolName === "get_now_et") {
        results.push({ toolCallId, result: { now_et: formatNowET() } });
        continue;
      }

      // 2) Tool: end_call_now
      if (toolName === "end_call_now") {
        results.push({ toolCallId, result: "Success." });
        continue;
      }

      // 3) Tool: print_star_receipt
      if (toolName === "print_star_receipt") {
        const rawMarkup =
          args.markup ?? args.content ?? args.text ?? args.items ?? "";

        if (!rawMarkup) {
          results.push({ toolCallId, result: "missing_markup" });
          continue;
        }

        // Clean redundant headers if Vapi sends them
        const cleaned = String(rawMarkup)
          .replace(/^Cash N Dash\s*/im, '')
          .replace(/^Timestamp:.*$/im, '')
          .trim();

        const now_et = args.now_et || formatNowET();

        // FORMAT COMPLETE RECEIPT TEMPLATE WITH BUZZER CHIME
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

[bold: on][mag: w 1; h 2]${cleaned}[mag][bold: off]

--------------------------------
[align: center]
[mag: w 1; h 1]THANK YOU!

[buzzer]
[cut]`;

        // Send to StarIO with 4-second timeout guard
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
          results.push({ toolCallId, result: `star_error_${response.status}` });
        } else {
          results.push({ toolCallId, result: "printed" });
        }
        continue;
      }

      // Unknown tool (still return something so Vapi doesn't hang)
      results.push({ toolCallId, result: `unknown_tool_${toolName}` });
    } catch (err) {
      console.error(`Error processing toolCallId ${toolCallId}:`, err);
      results.push({
        toolCallId,
        result: err?.name === "AbortError" ? "printer_timeout" : "server_error"
      });
    }
  }

  return res.status(200).json({ results });
});

// Health check endpoint
app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

// Start Webhook Server
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cash N Dash Webhook running on port ${port}`));
