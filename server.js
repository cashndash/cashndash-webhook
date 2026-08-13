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

// ======================================================
// CASH-N-DASH MASTER MENU PRICE LOOKUP TABLE
// ======================================================
const MENU_PRICES = {
  // Sandwiches & Abbreviations
  "grilled tenderloin": 6.79,
  "g.t.": 6.79,
  "breaded tenderloin": 6.79,
  "b.t.": 6.79,
  "grilled chicken": 5.99,
  "codfish": 5.89,
  "dixie cod fish sandwich": 5.89,
  "chicken patty": 5.99,
  "chicken sandwich": 5.99,
  "chicken club": 6.99,
  "blt": 5.49,
  "grilled cheese sandwich": 3.99,
  "grilled cheese": 3.99,

  // Burgers
  "hamburger": 5.29,
  "cheeseburger": 5.99,
  "double hamburger": 6.99,
  "double cheeseburger": 7.79,
  "bacon cheeseburger": 6.99,
  "bacon double cheeseburger": 7.99,

  // Add-ons & Extras
  "extra cheese": 0.50,
  "cheese": 0.50,
  "extra bacon": 2.00,
  "extra bacon(2 pieces)": 2.00,
  "extra bun": 1.00,

  // Drinks & Wedges
  "32oz fountain drink": 1.87,
  "32 oz fountain drink": 1.87,
  "20oz fountain drink": 1.29,
  "20 oz fountain drink": 1.29,
  "16oz fountain drink": 1.19,
  "16 oz fountain drink": 1.19,
  "fountain drink": 1.87,
  "potato wedge": 0.20,
  "potato wedges": 0.20,
  "5 potato wedges": 1.00,
  "8 potato wedges": 1.60,

  // Sauces ($0.75 each)
  "dipping cup": 0.75,
  "dipping cups": 0.75,
  "dipping cup (bbq)": 0.75,
  "dipping cup (honey mustard)": 0.75,
  "dipping cup (ranch)": 0.75,
  "bbq": 0.75,
  "honey mustard": 0.75,
  "ranch": 0.75,
  "bbq sauce": 0.75,
  "honey mustard sauce": 0.75,
  "ranch sauce": 0.75,

  // Sides
  "fries": 2.99,
  "crinkle fries": 2.99,
  "onion rings": 3.79,
  "mushrooms": 3.79,
  "cauliflower": 3.79,
  "cheese bite": 4.49,
  "cheese bites": 4.49,
  "cheese stick": 1.29,
  "cheese sticks": 6.29,
  "cheese sticks (1 pc)": 1.29,
  "cheese stick (1 pc)": 1.29,
  "cheese sticks (single)": 1.29,
  "cheese sticks (5 pcs)": 6.29,

  // Salads
  "side salad": 4.99,
  "side salad (1 dressing)": 4.99,
  "premium salad": 7.99,
  "premium salad (2 dressing)": 7.99,

  // Chicken Single Pieces & Boxes
  "breast": 2.99,
  "thigh": 2.49,
  "leg": 2.39,
  "wing": 2.29,
  "chicken tender": 2.49,
  "chicken liver box": 4.99,
  "corn dog": 2.69,
  "egg roll": 2.69,
  "one potato tater": 1.29,
  "two potato tater": 2.39,
  "crinkle fries box": 5.99,

  // Chicken Tenders
  "2 pc chicken tenders": 4.79,
  "2 pc tenders": 4.79,
  "3 pc chicken tenders": 6.99,
  "3 pc tenders": 6.99,
  "4 pc chicken tenders": 8.99,
  "4 pc tenders": 8.99,
  "6 pc chicken tenders": 12.99,
  "6 pc tenders": 12.99,

  // Daily Specials
  "daily special": 8.49,
  "daily specials": 8.49,
  "special": 8.49,
  "specials": 8.49,
  "monday special": 8.49,
  "tuesday special": 8.49,
  "wednesday special": 8.49,
  "thursday special": 8.49,
  "friday special": 8.49,
  "chicken special": 7.39,
  "tender basket special": 8.49,
  "tender basket": 8.49,
  "liver special": 7.19,

  // Chicken Meals
  "2 pc chicken dark": 5.59,
  "2 pc chicken mix": 6.19,
  "2 pc chicken white": 6.39,
  "3 pc chicken dark": 7.99,
  "3 pc chicken mix": 7.79,
  "3 pc chicken white": 8.29,
  "4 pc chicken dark": 9.39,
  "4 pc chicken mix": 10.69,
  "4 pc chicken white": 10.29,
  "8 pc chicken dark": 20.99,
  "8 pc chicken mix": 22.99,
  "8 pc chicken white": 23.99,
  "12 pc chicken dark": 28.99,
  "12 pc chicken mix": 29.99,
  "12 pc chicken white": 31.99
};

// Helper function to format Eastern Time
function formatNowET() {
  const now = new Date();

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
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

// Fallback lookup: Checks MENU_PRICES table or keyword matching if Vapi omitted the price
function addKnownItemPrice(line) {
  let cleanLine = line.trim().replace(/\s+/g, " ");

  // Normalize lines where price was attached at the front e.g. "$8.49 DAILY SPECIAL" -> "DAILY SPECIAL $8.49"
  const leadingPriceMatch = cleanLine.match(/^\$(\d+\.\d{2})\s+(.+)/i);
  if (leadingPriceMatch) {
    return `${leadingPriceMatch[2]} $${leadingPriceMatch[1]}`;
  }

  // If price is already present at the end, return directly
  if (/\$\d+\.\d{2}$/.test(cleanLine)) {
    return cleanLine;
  }

  // Strip leading dollarless numbers like "8.49 " or "$8.49 " if Vapi omitted "$"
  const normalizedLine = cleanLine.replace(/^\$?(\d+\.\d{2})\s+/i, "");

  // Extract quantity (if present) and clean item name
  const match = normalizedLine.match(/^(?:QTY\s+(\d+)\s+)?(.+?)(?:\s+\((?:ld|pln)\))?$/i);
  if (!match) return cleanLine;

  const qty = Number(match[1] || 1);
  const rawItemName = match[2].trim().toLowerCase();

  // 1. Exact match in MENU_PRICES table
  if (MENU_PRICES[rawItemName] !== undefined) {
    const itemTotal = (qty * MENU_PRICES[rawItemName]).toFixed(2);
    return `${normalizedLine} $${itemTotal}`;
  }

  // 2. Keyword matching for any Daily Special or Basket variation
  if (
    rawItemName.includes("special") ||
    rawItemName.includes("basket")
  ) {
    let specialPrice = 8.49; // Default daily special price

    if (rawItemName.includes("liver")) {
      specialPrice = 7.19;
    } else if (rawItemName.includes("chicken") && !rawItemName.includes("tender")) {
      specialPrice = 7.39;
    }

    const itemTotal = (qty * specialPrice).toFixed(2);
    return `${normalizedLine} $${itemTotal}`;
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
// DEDICATED VAPI TOOL ROUTE (/get-now-et)
// ======================================================
app.post("/get-now-et", (req, res) => {
  try {
    const toolCallList = req.body?.message?.toolCallList;

    if (!Array.isArray(toolCallList) || toolCallList.length === 0) {
      return res.status(400).json({
        error: "Expected Vapi message.toolCallList"
      });
    }

    const timeString =
      `Current Eastern Time: ${formatNowET()} Eastern Time.`;

    const results = toolCallList
      .filter((tc) => tc.function?.name === "get_now_et")
      .map((tc) => ({
        toolCallId: tc.id,
        result: timeString
      }));

    if (results.length === 0) {
      return res.status(400).json({
        error: "No get_now_et tool call found"
      });
    }

    return res.status(200).json({ results });
  } catch (error) {
    console.error("get-now-et error:", error);

    return res.status(500).json({
      error: "Unable to determine current Eastern Time"
    });
  }
});

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
        results.push({
          toolCallId,
          result: `Current Eastern Time: ${formatNowET()} Eastern Time.`
        });

        continue;
      }

      if (toolName === "end_call_now") {
        results.push({
          toolCallId,
          result: "Success."
        });

        continue;
      }

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

        let calculatedSubtotal = 0;
        let calculatedTaxableSubtotal = 0;

        let inBox = false;
        let comboHeaderPriced = false;

        const lines = rawStr.split("\n");

        for (let line of lines) {
          const trimmedLine = line.trim();

          if (!trimmedLine) {
            continue;
          }

          // Toggle special-item box status (Combo box)
          if (/^\*{10,}$/.test(trimmedLine)) {
            inBox = !inBox;
            if (!inBox) {
              comboHeaderPriced = false; // Reset combo box state when closing box
            }

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

          // Ignore Vapi's provided financial totals
          if (
            /^Subtotal/i.test(trimmedLine) ||
            /tax/i.test(trimmedLine) ||
            /total/i.test(trimmedLine)
          ) {
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

          // Skip source divider lines
          if (/^[-=]{10,}$/.test(trimmedLine)) {
            continue;
          }

          // Process item line with price fallbacks
          let pricedLine = addKnownItemPrice(trimmedLine);

          // If inside a combo box and the combo header (e.g. DAILY SPECIAL $8.49) was already charged,
          // strip individual prices from component items (burger, wedges, drink) so they are NOT double charged!
          if (inBox) {
            const isComboHeader = /special|basket/i.test(pricedLine);

            if (isComboHeader) {
              comboHeaderPriced = true;
            } else if (comboHeaderPriced) {
              // Strip price from combo component lines (e.g. "BACON CHEESEBURGER $6.99" -> "BACON CHEESEBURGER")
              pricedLine = pricedLine.replace(/\s+\$\d+\.\d{2}$/i, "").trim();
            }
          }

          // Sum item price to server-calculated totals when present
          const itemPriceMatch = pricedLine.match(/\$(\d+\.\d{2})/);
          if (itemPriceMatch) {
            const itemAmount = Number(itemPriceMatch[1]);

            calculatedSubtotal += itemAmount;

            // Extra Buns are tax-exempt. Other items are taxable.
            if (
              !/extra bun/i.test(pricedLine)
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

        // Calculate totals directly from receipt item prices.
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
