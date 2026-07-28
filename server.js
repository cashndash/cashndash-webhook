import express from "express";

const app = express();
app.use(express.json());

// In-memory queue
let printQueue = [];

// Helper: format Eastern Time
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
// ESC/POS & STAR COMMAND CONSTANTS
// ======================================================
const ESC = "\x1B";
const GS  = "\x1D";

const CMD_RESET        = ESC + "@";
const CMD_ALIGN_CENTER = ESC + "a" + "\x01";
const CMD_ALIGN_LEFT   = ESC + "a" + "\x00";

// Font Sizes (Height & Width multipliers)
const CMD_SIZE_NORMAL  = GS + "!" + "\x00"; // 1x Size
const CMD_SIZE_LARGE   = GS + "!" + "\x11"; // 2x Width & Height
const CMD_SIZE_XLARGE  = GS + "!" + "\x22"; // 3x Width & Height (Big)
const CMD_SIZE_XXLARGE = GS + "!" + "\x33"; // 4x Width & Height (HUGE)

// Styling
const CMD_BOLD_ON  = ESC + "E" + "\x01";
const CMD_BOLD_OFF = ESC + "E" + "\x00";

// Peripherals & Paper Handling
const CMD_BUZZER   = ESC + "\x07";
const CMD_FEED_3   = ESC + "d" + "\x04"; // Feed 4 lines before cut
const CMD_STAR_CUT = ESC + "d" + "\x02"; // Star native full cut

// ======================================================
// 1. VAPI WEBHOOK ENDPOINT (/print)
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

        const cleaned = String(rawMarkup)
          .replace(/^Cash N Dash\s*/im, "")
          .replace(/^Timestamp:.*$/im, "")
          .trim();

        const now_et = args.now_et || formatNowET();
        const jobId = Date.now().toString();

        // Build receipt with Extra Large fonts
        const receiptData = 
          CMD_RESET +
          
          // HEADER
          CMD_ALIGN_CENTER +
          CMD_BOLD_ON + CMD_SIZE_XLARGE + "Cash N Dash\n" + CMD_SIZE_NORMAL + CMD_BOLD_OFF +
          CMD_SIZE_LARGE + "512 WILLOW ST\n" +
          "VINCENNES, IN 47591\n" +
          "812-882-6102\n\n" +
          now_et + " ET\n\n" +

          // ORDER SECTION HEADER
          CMD_ALIGN_LEFT +
          "================================\n" +
          CMD_ALIGN_CENTER +
          CMD_BOLD_ON + CMD_SIZE_XLARGE + "ORDER DETAILS\n" + CMD_SIZE_NORMAL + CMD_BOLD_OFF +
          CMD_ALIGN_LEFT +
          "================================\n\n" +

          // ORDER ITEMS (XXLARGE - 4x Font Size)
          CMD_BOLD_ON + CMD_SIZE_XXLARGE + cleaned + "\n\n" + CMD_SIZE_NORMAL + CMD_BOLD_OFF +

          // FOOTER & CUTTER
          "================================\n" +
          CMD_ALIGN_CENTER +
          CMD_BOLD_ON + CMD_SIZE_LARGE + "THANK YOU!\n" + CMD_SIZE_NORMAL + CMD_BOLD_OFF +
          "================================\n" +
          
          CMD_BUZZER +
          CMD_FEED_3 +
          CMD_STAR_CUT;

        printQueue.push({ id: jobId, data: receiptData });
        console.log(`New job queued (ID: ${jobId}). Queue depth: ${printQueue.length}`);

        results.push({ toolCallId, result: "printed" });
        continue;
      }

      results.push({ toolCallId, result: `unknown_tool_${toolName}` });
    } catch (err) {
      console.error(`Error processing toolCallId ${toolCallId}:`, err);
      results.push({ toolCallId, result: "server_error" });
    }
  }

  return res.status(200).json({ results });
});


// ======================================================
// 2. STAR DIRECT CLOUDPRNT ENDPOINTS (/cloudprnt)
// ======================================================

// A) Printer Polls Server (POST)
app.post("/cloudprnt", (req, res) => {
  if (printQueue.length > 0) {
    const activeJob = printQueue[0];

    return res.status(200).json({
      jobReady: true,
      mediaTypes: ["application/vnd.star.starprntcore"],
      mediaType: "application/vnd.star.starprntcore",
      jobToken: activeJob.id
    });
  }

  return res.status(200).json({ jobReady: false });
});

// B) Printer Downloads Job (GET)
app.get("/cloudprnt", (req, res) => {
  const token = req.query.jobToken;

  if (printQueue.length === 0) {
    return res.status(404).send("No pending jobs");
  }

  const activeJob = printQueue[0];

  if (token && token !== activeJob.id) {
    return res.status(404).send("Invalid job token");
  }

  res.setHeader("Content-Type", "application/vnd.star.starprntcore");
  return res.status(200).send(activeJob.data);
});

// C) Printer Confirms Print Completion (DELETE)
app.delete("/cloudprnt", (req, res) => {
  const token = req.query.jobToken;

  if (printQueue.length > 0) {
    if (!token || printQueue[0].id === token) {
      const finishedJob = printQueue.shift();
      console.log(`Job ${finishedJob.id} completed & removed. Remaining: ${printQueue.length}`);
    } else {
      console.warn(`DELETE received for mismatched token ${token}. Expected ${printQueue[0].id}`);
    }
  }

  return res.status(200).json({ success: true });
});

// Health Check
app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cash N Dash Webhook running on port ${port}`));
