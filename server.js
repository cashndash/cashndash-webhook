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

// ======================================================
// PRINTER CONFIGURATION (STANDARD FONT = 48 COLUMNS EDGE-TO-EDGE)
// ======================================================
const MAX_COLS = 48; 
const DOTTED_LINE = "-".repeat(MAX_COLS);
const DOUBLE_LINE = "=".repeat(MAX_COLS);

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

// Right-align item prices cleanly across full 48 receipt columns
function formatItemWithPrice(itemNameStr, priceStr) {
  const cleanName = itemNameStr.replace(/^[\*\s\-:]+/g, "").replace(/[\*\s\-:]+$/g, "").trim();
  const priceVal = priceStr.startsWith("$") ? priceStr : `$${priceStr}`;

  const maxNameLen = MAX_COLS - priceVal.length - 1;
  let finalName = cleanName;

  if (cleanName.length > maxNameLen) {
    finalName = cleanName.substring(0, maxNameLen - 1) + ".";
  }

  const spaceNeeded = MAX_COLS - finalName.length - priceVal.length;
  return `${finalName}${" ".repeat(Math.max(1, spaceNeeded))}${priceVal}`;
}

// Right-align summary lines across full 48 receipt columns
function formatSummaryLine(label, amount) {
  const spaceNeeded = MAX_COLS - label.length - amount.length;
  if (spaceNeeded > 0) {
    return `${label}${" ".repeat(spaceNeeded)}${amount}`;
  }
  return `${label} ${amount}`;
}

// Process and clean up Vapi Special Boxed Blocks for 48-column standard font
function processBoxedLines(boxedLinesBuffer) {
  if (boxedLinesBuffer.length === 0) return [];

  let extractedPrice = "";
  let titleLine = "";
  let subItems = [];

  for (let rawLine of boxedLinesBuffer) {
    const line = rawLine.trim();
    if (!line) continue;

    // Check if line is purely standalone prices like "$8.49 $8.49" or "$8.49"
    const isPurePriceLine = /^(\$?(\d+\.\d{2})\s*)+$/.test(line);
    if (isPurePriceLine) {
      const match = line.match(/\$?(\d+\.\d{2})/);
      if (match && !extractedPrice) {
        extractedPrice = `$${match[1]}`;
      }
      continue;
    }

    // Check if line contains title keywords like "DAILY SPECIAL" or "SPECIAL"
    if (/special/i.test(line) && !titleLine) {
      const match = line.match(/\$?(\d+\.\d{2})/);
      if (match) {
        extractedPrice = `$${match[1]}`;
      }
      titleLine = line.replace(/\$?(\d+\.\d{2})/g, "").trim();
    } else {
      subItems.push(line);
    }
  }

  const result = [];
  result.push(`${DOTTED_LINE}`);

  // Print Header Title with Price Flush Far Right
  if (titleLine && extractedPrice) {
    const headerStr = formatItemWithPrice(titleLine, extractedPrice);
    result.push(`[bold: on]${headerStr}[bold: off]`);
  } else if (titleLine) {
    result.push(`[bold: on]${titleLine}[bold: off]`);
  } else if (extractedPrice) {
    const headerStr = formatItemWithPrice("SPECIAL", extractedPrice);
    result.push(`[bold: on]${headerStr}[bold: off]`);
  }

  // Print Sub-items under the title
  for (let item of subItems) {
    const cleanSub = item.replace(/^[\*\s\-:]+/g, "").trim();
    result.push(`[bold: on]  ${cleanSub}[bold: off]`);
  }

  result.push(`${DOTTED_LINE}`);
  return result;
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
        let specialNotesList = [];
        let subtotalVal = "";
        let taxVal = "";
        let totalVal = "";

        let inBox = false;
        let boxedBuffer = [];

        const lines = rawStr.split("\n");
        for (let line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Toggle inBox status for Vapi special boxed blocks
          if (/^\*{10,}$/.test(trimmedLine)) {
            if (inBox) {
              const formattedBox = processBoxedLines(boxedBuffer);
              itemsList.push(...formattedBox);
              boxedBuffer = [];
              inBox = false;
            } else {
              inBox = true;
              boxedBuffer = [];
            }
            continue;
          }

          if (inBox) {
            boxedBuffer.push(trimmedLine);
            continue;
          }

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
          // Parse Financial Totals
          else if (/^Subtotal/i.test(trimmedLine)) {
            const match = trimmedLine.match(/\$?(\d+\.\d{2})/);
            if (match) subtotalVal = `$${match[1]}`;
          } 
          else if (/tax/i.test(trimmedLine)) {
            const match = trimmedLine.match(/\$?(\d+\.\d{2})/);
            if (match) taxVal = `$${match[1]}`;
          } 
          else if (/total/i.test(trimmedLine)) {
            const match = trimmedLine.match(/\$?(\d+\.\d{2})/);
            if (match) totalVal = `$${match[1]}`;
          }
          // Parse Separate Special Instructions / Notes
          else if (/^(?:Special|Notes?|Instructions?|Requests?|Allergies)\s*[:\-]/i.test(trimmedLine)) {
            specialNotesList.push(trimmedLine);
          }
          // Parse Regular Food Items
          else {
            const priceMatch = trimmedLine.match(/\$?(\d+\.\d{2})/);
            if (priceMatch) {
              const formatted = formatItemWithPrice(trimmedLine, priceMatch[1]);
              itemsList.push(`[bold: on]${formatted}[bold: off]`);
            } else {
              const cleanItem = trimmedLine.replace(/^[\*\s\-:]+/g, "").trim();
              itemsList.push(`[bold: on]${cleanItem}[bold: off]`);
            }
          }
        }

        const customerInfoStr = `Customer Name: ${custName}\nPhone Number: ${custPhone}`;

        const formattedItemsStr = itemsList.length > 0 
          ? itemsList.join("\n") 
          : "[bold: on]No Items Detected[bold: off]";

        // Build Special Notes Block if explicitly passed separately
        let specialMarkup = "";
        if (specialNotesList.length > 0) {
          specialMarkup = 
`${DOTTED_LINE}
[bold: on]SPECIAL INSTRUCTIONS:[bold: off]
[bold: on]${specialNotesList.join("\n")}[bold: off]
`;
        }

        const now_et = args.now_et || formatNowET();

        // 48-COLUMN FULL-WIDTH FINANCIAL BLOCK
        let totalsMarkup = `${DOTTED_LINE}\n`;
        if (subtotalVal) {
          totalsMarkup += `[bold: on]${formatSummaryLine("Subtotal:", subtotalVal)}[bold: off]\n`;
        }
        if (taxVal) {
          totalsMarkup += `[bold: on]${formatSummaryLine("Sales Tax:", taxVal)}[bold: off]\n`;
        }
        totalsMarkup += `${DOUBLE_LINE}\n`;
        if (totalVal) {
          totalsMarkup += `[bold: on][mag: w 1; h 2]${formatSummaryLine("TOTAL:", totalVal)}[mag][bold: off]\n`;
        }

        // FULL EDGE-TO-EDGE RECEIPT TEMPLATE
        const formattedMarkup = 
`[align: center]
[bold: on][mag: w 2; h 2]Cash N Dash[mag][bold: off]
512 WILLOW ST | VINCENNES, IN 47591
812-882-6102 | ${now_et} ET
[align: left]
${DOTTED_LINE}
[bold: on]CUSTOMER DETAILS:[bold: off]
[bold: on]${customerInfoStr}[bold: off]
${DOTTED_LINE}
[align: center]
[bold: on][mag: w 1; h 2]KITCHEN ORDER[mag][bold: off]
${DOTTED_LINE}
[align: left]
${formattedItemsStr}

${specialMarkup}[align: left]
${totalsMarkup}
[align: center]
${DOTTED_LINE}
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
