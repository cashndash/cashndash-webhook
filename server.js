import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// StarIO.Online endpoint configured with your active Device Queue Token
const STAR_ENDPOINT = "https://api.stario.online/v1/a/CASHNDASH/d/4cfe6e42/q";
const STAR_API_KEY = process.env.STAR_API_KEY;

if (!STAR_API_KEY) {
  console.warn("WARNING: STAR_API_KEY environment variable is not set.");
}

// In-memory queue reference
let printQueue = [];

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

// ======================================================
// MAIN VAPI WEBHOOK ROUTE (/print)
// ======================================================
app.post("/print", async (req, res) => {
  const toolCallList = req.body?.message?.toolCallList || [];

  if (!Array.isArray(toolCallList) || toolCallList.length === 0) {
    return res.status(200).json({ results: [] });
  }

  const results = [];

  for (const tc of toolCallList) {
    const toolCallId = tc.id;
    const toolName = tc.function?.name;

    let args = tc.function?.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = { markup: args };
      }
    }

    try {
      if (toolName === "get_now_et") {
        results.push({ toolCallId, result: { now_et: formatNowET() } });
        continue;
      }

      if (toolName === "end_call_now") {
        results.push({ toolCallId, result: "Success." });
        continue;
      }

      if (toolName === "print_star_receipt") {
        const rawMarkup = args.markup ?? args.content ?? args.text ?? args.items ?? "";

        if (!rawMarkup) {
          results.push({ toolCallId, result: "missing_markup" });
          continue;
        }

        const rawStr = String(rawMarkup)
          .replace(/^Cash N Dash\s*/im, "")
          .replace(/^Timestamp:.*$/im, "")
          .trim();

        // Separate Customer Info from Order Items
        let customerInfoLines = [];
        let itemsList = [];

        const lines = rawStr.split("\n");
        for (let line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Detect Customer Details (Name & Phone)
          if (
            /^Customer Name:/i.test(trimmedLine) || 
            /^Phone Number:/i.test(trimmedLine) || 
            /^Name:/i.test(trimmedLine) || 
            /^Phone:/i.test(trimmedLine)
          ) {
            customerInfoLines.push(trimmedLine);
          } else {
            // Clean leading bullets/dashes/asterisks and format strictly with one '*'
            const cleanItem = trimmedLine.replace(/^[\*\s\-]+/g, "").trim();
            if (cleanItem) {
              itemsList.push(`* ${cleanItem}`);
            }
          }
        }

        const customerInfoStr = customerInfoLines.length > 0 
          ? customerInfoLines.join("\n") 
          : "Customer: N/A";

        const formattedItemsStr = itemsList.length > 0 
          ? itemsList.join("\n") 
          : `* ${rawStr}`;

        const now_et = args.now_et || formatNowET();

        // ULTRA-COMPACT TICKET TEMPLATE WITH DATE & TIME
        const formattedMarkup = 
`[align: center]
[bold: on]Cash N Dash[bold: off]
${now_et} ET
[align: left]
[bold: on]${customerInfoStr}[bold: off]
--------------------------------
[align: center]
[bold: on][mag: w 1; h 2]ORDER DETAILS[mag][bold: off]
[align: left]
[bold: on][mag: w 1; h 2]${formattedItemsStr}[mag][bold: off]
[align: center]
--------------------------------
[bold: on]❀ THANK YOU! ❀[bold: off]
[buzzer]
[cut]`;

        // Send payload directly to StarIO Cloud API
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
          console.log("Job printed via StarIO!");
          results.push({ toolCallId, result: "printed" });
        }
        continue;
      }

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

// Manual Queue Clear Endpoint
app.get("/clear", (_req, res) => {
  const count = printQueue.length;
  printQueue = [];
  console.log(`Manual clear executed. Cleared ${count} pending jobs.`);
  res.status(200).send(`Queue cleared! Removed ${count} pending jobs.`);
});

// Health check endpoint
app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cash N Dash Webhook running on port ${port}`));
