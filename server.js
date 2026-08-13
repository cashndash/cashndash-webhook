import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Set both of these in Render environment variables.
const STAR_ENDPOINT = process.env.STAR_ENDPOINT;
const STAR_API_KEY = process.env.STAR_API_KEY;

if (!STAR_ENDPOINT) {
  console.warn("WARNING: STAR_ENDPOINT environment variable is not set.");
}

if (!STAR_API_KEY) {
  console.warn("WARNING: STAR_API_KEY environment variable is not set.");
}

let printQueue = [];

// ======================================================
// PRINTER CONFIGURATION (32 COLUMNS FOR KITCHEN FONT)
// ======================================================
const MAX_COLS = 32;
const DOTTED_LINE = "-".repeat(MAX_COLS);

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

// Helper function to get Eastern Time day of week
function getDayET() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long"
  }).format(new Date());
}

// Deterministic fallback for unpriced Tenderloin lines from Vapi
function addKnownItemPrice(line) {
  const cleanLine = line.trim().replace(/\s+/g, " ");

  // Do not add a second price if Vapi already supplied one.
  if (/\$?(\d+\.\d{2})/.test(cleanLine)) {
    return cleanLine;
  }

  // Breaded Tenderloin: B.T., B.T. (ld), B.T. (pln), including QTY lines.
  const breadedTenderloinMatch = cleanLine.match(
    /^(?:QTY\s+(\d+)\s+)?B\.T\.(?:\s+\((?:ld|pln)\))?$/i
  );

  if (breadedTenderloinMatch) {
    const quantity = Number(breadedTenderloinMatch[1] || 1);
    const price = (quantity * 6.79).toFixed(2);

    return `${cleanLine} $${price}`;
  }

  // Grilled Tenderloin: G.T., including QTY lines.
  const grilledTenderloinMatch = cleanLine.match(
    /^(?:QTY\s+(\d+)\s+)?G\.T\.$/i
  );

  if (grilledTenderloinMatch) {
    const quantity = Number(grilledTenderloinMatch[1] || 1);
    const price = (quantity * 6.79).toFixed(2);

    return `${cleanLine} $${price}`;
  }

  return cleanLine;
}

// Format regular food items with right-aligned prices
function formatItemWithPrice(line) {
  const priceMatch = line.match(/\$?(\d+\.\d{2})/);

  if (priceMatch) {
    const priceVal = `$${priceMatch[1]}`;

    // Remove the price from the item name text
    let mainName = line
      .replace(/\$?(\d+\.\d{2})/g, "")
      .replace(/^[\*\s\-:]+/g, "")
      .replace(/[\*\s\-:]+$/g, "")
      .trim();

    const maxNameLen = MAX_COLS - priceVal.length - 1;
    if (mainName.length > maxNameLen) {
      mainName = mainName.substring(0, maxNameLen - 1) + ".";
    }

    // Exact space count needed to push priceVal to column 32 (far right)
    const spaceNeeded = MAX_COLS - mainName.length - priceVal.length;
    const padding = " ".repeat(Math.max(1, spaceNeeded));

    return `${mainName}${padding}${priceVal}`;
  }

  // Preserve leading "-" for receipt modifier lines such as -L,-O.
  return line.replace(/^[\*\s]+/g, "").trim();
}

// Right-align summary lines across 32 receipt columns
function formatSummaryLine(label, amount) {
  const spaceNeeded = MAX_COLS - label.length - amount.length;

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
      // --------------------------------------------------
      // GET EASTERN TIME
      // --------------------------------------------------
      if (toolName === "get_now_et") {
        const nowET = formatNowET();
        const dayET = getDayET();

        results.push({
          toolCallId,
          result: `Current Eastern Time: ${nowET}. Today is ${dayET}.`
        });

        continue;
      }

      // --------------------------------------------------
      // END CALL
      // --------------------------------------------------
      if (toolName === "end_call_now") {
        results.push({
          toolCallId,
          result: "Success."
        });

        continue;
      }

      // --------------------------------------------------
      // PRINT STAR RECEIPT
      // --------------------------------------------------
      if (toolName === "print_star_receipt") {
        const rawMarkup =
          args.markup ??
          args.content ??
          args.text ??
          args.items ??
          "";

        if (!rawMarkup) {
          results.push({
            toolCallId,
            result: "missing_markup"
          });

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

        // Render calculates totals from the item lines.
        // Do not trust totals provided by Vapi.
        let calculatedSubtotal = 0;
        let calculatedTaxableSubtotal = 0;

        let inBox = false;

        const lines = rawStr.split("\n");

        for (let line of lines) {
          const trimmedLine = line.trim();

          if (!trimmedLine) {
            continue;
          }

          // Toggle special-item box status.
          if (/^\*{10,}$/.test(trimmedLine)) {
            inBox = !inBox;

            itemsList.push(
              `[bold: on][mag: h 2]${trimmedLine}[mag][bold: off]`
            );

            continue;
          }

          // Print special-box content verbatim.
          if (inBox) {
            itemsList.push(
              `[bold: on][mag: h 2]${trimmedLine}[mag][bold: off]`
            );

            continue;
          }

          // Ignore source receipt headers and footer noise.
          if (
            /Cash N Dash/i.test(trimmedLine) ||
            /Date:/i.test(trimmedLine) ||
            /Thank you/i.test(trimmedLine) ||
            /Timestamp:/i.test(trimmedLine)
          ) {
            continue;
          }

          // Customer name
          if (
            /^(?:Customer\s*Name|Customer|Name)\s*[:\-]\s*(.+)/i.test(
              trimmedLine
            )
          ) {
            const m = trimmedLine.match(
              /^(?:Customer\s*Name|Customer|Name)\s*[:\-]\s*(.+)/i
            );

            if (m && m[1].trim() && !/n\/a/i.test(m[1])) {
              custName = m[1].replace(/[\*\s]+/g, " ").trim();
            }

            continue;
          }

          // Customer phone
          if (
            /^(?:Phone\s*Number|Phone|Cell|Tel)\s*[:\-]\s*(.+)/i.test(
              trimmedLine
            )
          ) {
            const m = trimmedLine.match(
              /^(?:Phone\s*Number|Phone|Cell|Tel)\s*[:\-]\s*(.+)/i
            );

            if (m && m[1].trim() && !/n\/a/i.test(m[1])) {
              custPhone = m[1].replace(/[\*\s]+/g, " ").trim();
            }

            continue;
          }

          // Ignore Vapi's financial totals (we calculate them directly now)
          if (/^Subtotal/i.test(trimmedLine) || /tax/i.test(trimmedLine) || /total/i.test(trimmedLine)) {
            continue;
          }

          // Special instructions
          if (
            /^(?:Special|Notes?|Instructions?|Requests?|Allergies)\s*[:\-]/i.test(
              trimmedLine
            )
          ) {
            specialNotesList.push(trimmedLine);
            continue;
          }

          // Skip source divider lines; the template rebuilds them later.
          if (/^[-=]{10,}$/.test(trimmedLine)) {
            continue;
          }

          // Regular food items and modifier-only lines
          const pricedLine = addKnownItemPrice(trimmedLine);
          
          // Add an item price to Render-calculated totals when present.
          const itemPriceMatch = pricedLine.match(/\$(\d+\.\d{2})/);
          if (itemPriceMatch) {
            const itemAmount = Number(itemPriceMatch[1]);

            calculatedSubtotal += itemAmount;

            // Extra Buns are tax-exempt. Other ordinary items are taxable.
            if (
              !/^Extra Bun$/i.test(pricedLine) &&
              !/^QTY\s+\d+\s+Extra Bun$/i.test(pricedLine)
            ) {
              calculatedTaxableSubtotal += itemAmount;
            }
          }
          
          const formatted = formatItemWithPrice(pricedLine);

          itemsList.push(
            `[bold: on][mag: h 2]${formatted}[mag][bold: off]`
          );
        }

        const customerInfoStr =
          `Customer Name: ${custName}\n` +
          `Phone Number: ${custPhone}`;

        const formattedItemsStr =
          itemsList.length > 0
            ? itemsList.join("\n")
            : "[bold: on][mag: h 2]No Items Detected[mag][bold: off]";

        let specialMarkup = "";

        if (specialNotesList.length > 0) {
          specialMarkup =
`[bold: on][mag: h 2]${DOTTED_LINE}[mag][bold: off]
[bold: on][mag: h 2]SPECIAL INSTRUCTIONS:[mag][bold: off]
[bold: on][mag: h 2]${specialNotesList.join("\n")}[mag][bold: off]
`;
        }

        const nowET = args.now_et || formatNowET();

        // Calculate totals from the receipt item prices.
        const calculatedTax =
          Math.round(calculatedTaxableSubtotal * 0.07 * 100) / 100;
        const calculatedTotal =
          calculatedSubtotal + calculatedTax;

        subtotalVal = `$${calculatedSubtotal.toFixed(2)}`;
        taxVal = `$${calculatedTax.toFixed(2)}`;
        totalVal = `$${calculatedTotal.toFixed(2)}`;

        let totalsMarkup = "--------------------------------\n";

        totalsMarkup +=
          `[bold: on]${formatSummaryLine("Subtotal:", subtotalVal)}[bold: off]\n`;

        totalsMarkup +=
          `[bold: on]${formatSummaryLine("Sales Tax:", taxVal)}[bold: off]\n`;

        totalsMarkup += "================================\n";

        totalsMarkup +=
          `[bold: on][mag: w 1; h 2]` +
          `${formatSummaryLine("TOTAL:", totalVal)}` +
          `[mag][bold: off]\n`;

        const formattedMarkup =
`[align: center]
[bold: on][mag: w 2; h 2]Cash N Dash[mag][bold: off]
512 WILLOW ST | VINCENNES, IN 47591
812-882-6102 | ${nowET} ET
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

${specialMarkup}[align: left]
${totalsMarkup}
[align: center]
--------------------------------
[bold: on]THANK YOU![bold: off]

[buzzer]
[buzzer]
[buzzer]
[buzzer]
[buzzer]
[cut]`;

        // Check that Render environment variables are available.
        if (!STAR_ENDPOINT || !STAR_API_KEY) {
          console.error("Missing Star configuration:", {
            hasStarEndpoint: Boolean(STAR_ENDPOINT),
            hasStarApiKey: Boolean(STAR_API_KEY)
          });

          results.push({
            toolCallId,
            result: "printer_configuration_missing"
          });

          continue;
        }

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

          results.push({
            toolCallId,
            result: `star_error_${response.status}`
          });
        } else {
          console.log("Job printed via StarIO!");

          results.push({
            toolCallId,
            result: "printed"
          });
        }

        continue;
      }

      results.push({
        toolCallId,
        result: `unknown_tool_${toolName}`
      });
    } catch (err) {
      console.error(`Error processing toolCallId ${toolCallId}:`, err);

      results.push({
        toolCallId,
        result:
          err?.name === "AbortError"
            ? "printer_timeout"
            : "server_error"
      });
    }
  }

  return res.status(200).json({ results });
});

app.get("/clear", (_req, res) => {
  const count = printQueue.length;

  printQueue = [];

  console.log(`Manual clear executed. Cleared ${count} pending jobs.`);

  res.send(`Queue cleared! Removed ${count} pending jobs.`);
});

app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log(`Cash N Dash Webhook running on port ${port}`);
});
