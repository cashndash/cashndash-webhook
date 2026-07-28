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

// Helper function to right-align item prices cleanly across 32 receipt columns
function formatItemWithPrice(line) {
  const maxLen = 32; // Standard 80mm receipt width in standard font

  // Extract price if present anywhere in the string (e.g., "$7.99 Bacon Cheeseburger" or "Bacon Cheeseburger $7.99")
  const priceMatch = line.match(/\$?(\d+\.\d{2})/);
  
  if (priceMatch) {
    const priceVal = `$${priceMatch[1]}`;
    // Remove price and extraneous symbols from item description
    let itemName = line
      .replace(/\$?(\d+\.\d{2})/, "")
      .replace(/^[\*\s\-:]+/g, "")
      .replace(/[\*\s\-:]+$/g, "")
      .trim();

    const formattedName = `* ${itemName}`;
    const spaceNeeded = maxLen - formattedName.length - priceVal.length;

    if (spaceNeeded > 0) {
      return `${formattedName}${" ".repeat(spaceNeeded)}${priceVal}`;
    }
    return `${formattedName} ${priceVal}`;
  }

  // Fallback if line has no price attached
  const cleanLine = line.replace(/^[\*\s\-]+/g, "").trim();
  return `* ${cleanLine}`;
}

// Helper function to right-align summary lines across 32 receipt columns
function formatSummaryLine(label, amount) {
  const maxLen = 32;
  const spaceNeeded = maxLen - label.length - amount.length;
  if (spaceNeeded > 0) {
    return `${label}${" ".repeat(spaceNeeded)}${amount}`;
  }
  return `${label} ${amount}`;
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

        let customerInfoLines = [];
        let itemsList = [];
        let subtotalStr = "";
        let taxStr = "";
        let totalStr = "";

        const lines = rawStr.split("\n");
        for (let line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Parse Customer Details
          if (
            /^Customer Name:/i.test(trimmedLine) || 
            /^Phone Number:/i.test(trimmedLine) || 
            /^Name:/i.test(trimmedLine) || 
            /^Phone:/i.test(trimmedLine)
          ) {
            customerInfoLines.push(trimmedLine);
          }
          // Parse Financial Totals
          else if (/^Subtotal:/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^Subtotal:\s*(\$?\d+(?:\.\d{2})?)/i);
            const val = match ? (match[1].startsWith("$") ? match[1] : `$${match[1]}`) : "";
            subtotalStr = val ? formatSummaryLine("Subtotal:", val) : trimmedLine;
          } else if (/^Tax:/i.test(trimmedLine) || /^Sales Tax:/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(?:Sales\s+)?Tax:\s*(\$?\d+(?:\.\d{2})?)/i);
            const val = match ? (match[1].startsWith("$") ? match[1] : `$${match[1]}`) : "";
            taxStr = val ? formatSummaryLine("Sales Tax:", val) : trimmedLine;
          } else if (/^Total:/i.test(trimmedLine) || /^Grand Total:/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(?:Grand\s+)?Total:\s*(\$?\d+(?:\.\d{2})?)/i);
            const val = match ? (match[1].startsWith("$") ? match[1] : `$${match[1]}`) : "";
            totalStr = val ? formatSummaryLine("TOTAL:", val) : trimmedLine;
          }
          // Parse Order Items
          else {
            itemsList.push(formatItemWithPrice(trimmedLine));
          }
        }

        const customerInfoStr = customerInfoLines.length > 0 
          ? customerInfoLines.join("\n") 
          : "Customer: N/A";

        const formattedItemsStr = itemsList.length > 0 
          ? itemsList.join("\n") 
          : `* ${rawStr}`;

        const now_et = args.now_et || formatNowET();

        // Build Totals Section: Subtotal -> Sales Tax -> Double Lines -> TOTAL
        let totalsMarkup = "";
        if (subtotalStr || taxStr || totalStr) {
          totalsMarkup += `--------------------------------\n`;
          if (subtotalStr) totalsMarkup += `[bold: on]${subtotalStr}[bold: off]\n`;
          if (taxStr) totalsMarkup += `[bold: on]${taxStr}[bold: off]\n`;
          totalsMarkup += `================================\n`;
          if (totalStr) totalsMarkup += `[bold: on][mag: w 1; h 2]${totalStr}[mag][bold: off]\n`;
        }

        // PERFECT PRO RECEIPT MARKUP TEMPLATE
        const formattedMarkup = 
`[align: center]
[bold: on][mag: w 2; h 2]Cash N Dash[mag][bold: off]

512 WILLOW ST
VINCENNES, IN 47591
812-882-6102
${now_et} ET

[align: left]
--------------------------------
[bold: on]CUSTOMER DETAILS:[bold: off]
[bold: on]${customerInfoStr}[bold: off]
--------------------------------
[align: center]
[bold: on][mag: w 1; h 2]ORDER DETAILS[mag][bold: off]
--------------------------------

[align: left]
[bold: on]${formattedItemsStr}[bold: off]

[align: left]
${totalsMarkup}
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
