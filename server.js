import express from "express";

const app = express();
app.use(express.json());

// In-memory queue to store pending print jobs
let pendingPrintJob = null;

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
          .replace(/^Cash N Dash\s*/im, '')
          .replace(/^Timestamp:.*$/im, '')
          .trim();

        const now_et = args.now_et || formatNowET();

        // Save formatted markup to in-memory queue for CloudPRNT polling
        pendingPrintJob = 
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

        console.log("New job queued for direct CloudPRNT printing.");
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

// Endpoint A: Printer Polls Server (POST)
app.post("/cloudprnt", (req, res) => {
  // If there is a pending job, inform printer jobReady is true
  if (pendingPrintJob) {
    return res.status(200).json({
      jobReady: true,
      mediaTypes: ["text/vnd.star.markup"]
    });
  }

  // No job available
  return res.status(200).json({
    jobReady: false
  });
});

// Endpoint B: Printer Downloads the Print Markup (GET)
app.get("/cloudprnt", (req, res) => {
  if (!pendingPrintJob) {
    return res.status(404).send("No job pending");
  }

  res.setHeader("Content-Type", "text/vnd.star.markup");
  res.send(pendingPrintJob);
});

// Endpoint C: Printer Confirms Print Completion (DELETE)
app.delete("/cloudprnt", (req, res) => {
  console.log("Printer completed print job successfully.");
  pendingPrintJob = null; // Clear queue
  res.status(200).send("OK");
});


// Health Check & Server Listener
app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cash N Dash Webhook running on port ${port}`));
