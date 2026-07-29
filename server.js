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

// Right-align item prices cleanly across standard 32 receipt columns
function formatItemWithPrice(line) {
  const maxLen = 32;

  // Extract price if present anywhere in the string
  const priceMatch = line.match(/\$?(\d+\.\d{2})/);
  
  if (priceMatch) {
    const priceVal = `$${priceMatch[1]}`;
    let itemName = line
      .replace(/\$?(\d+\.\d{2})/, "")
      .replace(/^[\*\s\-:]+/g, "")
      .replace(/[\*\s\-:]+$/g, "")
      .trim();

    const formattedName = `* ${itemName}`;
    const maxNameLen = maxLen - priceVal.length - 1;
    let finalName = formattedName;

    if (formattedName.length > maxNameLen) {
      finalName = formattedName.substring(0, maxNameLen - 1) + ".";
    }

    const spaceNeeded = maxLen - finalName.length - priceVal.length;
    return `${finalName}${" ".repeat(Math.max(1, spaceNeeded))}${priceVal}`;
  }

  // Fallback if line has no price
  const cleanLine = line.replace(/^[\*\s\-]+/g, "").trim();
  return `* ${cleanLine}`;
}

// Right-align summary lines across 32 receipt columns
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

        const rawStr = String(rawMarkup).trim();

        let custName = "N/A";
        let custPhone = "N/A";
        let itemsList = [];
        let subtotalVal = "";
        let taxVal = "";
        let totalVal = "";

        const lines = rawStr.split("\n");
        for (let line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Filter out Vapi header/footer noise, dates, timestamps, or thank-you messages
          if (
            /Cash N Dash/i.test(trimmedLine) ||
            /Date:/i.test(trimmedLine) ||
            /Thank you/i.test(trimmedLine) ||
            /Timestamp:/i.test(trimmedLine)
          ) {
            continue;
          }

          // Parse Customer Details
          if (/^(?:Customer\s*Name|Customer|Name)\s*[:\-]\s*(.+)/i.test(trimmedLine)) {
            const m = trimmedLine.match(/^(?:Customer\s*Name|Customer|Name)\s*[:\-]\s*(.+)/i);
            if (m && m[1].trim() && !/n\/a/i.test(m[1])) {
              custName = m[1].replace(/[\*\s]+/g, " ").trim();
            }
          } 
          else if (/^(?:Phone\s*Number|Phone|Cell|Tel)\s*[:\-]\s*(.+)/i.test(trimmedLine)) {
            const m = trimmedLine.match(/^(?:Phone\s*Number|Phone|Cell|Tel)\s*[:\-]\s*(.+)/i);
            if (m && m[1].trim() && !/n\/a/i.test(m[1])) {
              custPhone = m[1].replace(/[\*\s]+/g, " ").trim();
            }
          }
          // Parse Financial Totals strictly
          else if (/^Subtotal:/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^Subtotal:\s*(\$?\d+(?:\.\d{2})?)/i);
            if (match) subtotalVal = match[1].startsWith("$") ? match[1] : `$${match[1]}`;
          } else if (/^(?:Sales\s+)?Tax/i.test(trimmedLine)) {
            const match = trimmedLine.match(/(?:Sales\s+)?Tax(?:\s*\(\d+%\))?:\s*(\$?\d+(?:\.\d{2})?)/i);
            if (match) taxVal = match[1].startsWith("$") ? match[1] : `$${match[1]}`;
          } else if (/^(?:Grand\s+)?Total:/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(?:Grand\s+)?Total:\s*(\$?\d+(?:\.\d{2})?)/i);
            if (match) totalVal = match[1].startsWith("$") ? match[1] : `$${match[1]}`;
          }
          // Parse Food Items
          else {
            const formatted = formatItemWithPrice(trimmedLine);
            // Apply double-height and bold per item line to prevent layout breaks
            itemsList.push(`[bold: on][mag: h 2]${formatted}[mag][bold: off]`);
          }
        }

        const customerInfoStr = `Customer Name: ${custName}\nPhone Number: ${custPhone}`;

        const formattedItemsStr = itemsList.length > 0 
          ? itemsList.join("\n") 
          : "[bold: on]* No Items Detected[bold: off]";

        const now_et = args.now_et || formatNowET();

        // STRICT FINANCIAL BLOCK: Dotted Line -> Subtotal -> Sales Tax -> Double Line -> TOTAL
        let totalsMarkup = "";
        if (subtotalVal || taxVal || totalVal) {
          totalsMarkup += `--------------------------------\n`;
          if (subtotalVal) {
            totalsMarkup += `[bold: on]${formatSummaryLine("Subtotal:", subtotalVal)}[bold: off]\n`;
          }
          if (taxVal) {
            totalsMarkup += `[bold: on]${formatSummaryLine("Sales Tax:", taxVal)}[bold: off]\n`;
          }
          totalsMarkup += `================================\n`;
          if (totalVal) {
            totalsMarkup += `[bold: on][mag: w 1; h 2]${formatSummaryLine("TOTAL:", totalVal)}[mag][bold: off]\n`;
          }
        }

        // RECEIPT MARKUP
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
[bold: on][mag: w 1; h 2]KITCHEN ORDER[mag][bold: off]
--------------------------------

[align: left]
${formattedItemsStr}

[align: left]
${totalsMarkup}
[align: center]
--------------------------------
[bold: on]THANK YOU![bold: off]

[buzzer]
[cut]`;

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

app.get("/clear", (_req, res) => {
  const count = printQueue.length;
  printQueue = [];
  console.log(`Manual clear executed. Cleared ${count} pending jobs.`);
  res.status(200).send(`Queue cleared! Removed ${count} pending jobs.`);
});

app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cash N Dash Webhook running on port ${port}`));
