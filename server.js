import express from "express";

const app = express();
app.use(express.json());

// ===============================
// SIMPLE IN-MEMORY PRINT QUEUE
// ===============================
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

// ===============================
// 1) VAPI WEBHOOK: /print
// ===============================
app.post("/print", async (req, res) => {
  const toolCallList = req.body?.message?.toolCallList || [];

  if (!Array.isArray(toolCallList) || toolCallList.length === 0) {
    console.log("No tool calls in request.");
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
      // Tool: get_now_et
      if (toolName === "get_now_et") {
        results.push({ toolCallId, result: { now_et: formatNowET() } });
        continue;
      }

      // Tool: end_call_now
      if (toolName === "end_call_now") {
        results.push({ toolCallId, result: "Success." });
        continue;
      }

      // Tool: print_star_receipt
      if (toolName === "print_star_receipt") {
        const rawMarkup =
          args.markup ?? args.content ?? args.text ?? args.items ?? "";

        if (!rawMarkup) {
          console.log("Missing markup in print_star_receipt.");
          results.push({ toolCallId, result: "missing_markup" });
          continue;
        }

        const cleaned = String(rawMarkup)
          .replace(/^Cash N Dash\s*/im, "")
          .replace(/^Timestamp:.*$/im, "")
          .trim();

        const now_et = args.now_et || formatNowET();

        const jobId = Date.now().toString();

        const starMarkup = `
[align: center]
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
[cut]
`.trim();

        const newJob = {
          id: jobId,
          markup: starMarkup
        };

        printQueue.push(newJob);
        console.log(
          `New job queued (ID: ${jobId}). Queue depth: ${printQueue.length}`
        );

        results.push({ toolCallId, result: "printed" });
        continue;
      }

      // Unknown tool
      results.push({ toolCallId, result: `unknown_tool_${toolName}` });
    } catch (err) {
      console.error(`Error processing toolCallId ${toolCallId}:`, err);
      results.push({ toolCallId, result: "server_error" });
    }
  }

  return res.status(200).json({ results });
});

// ===============================
// 2) CLOUDPRNT ENDPOINTS: /cloudprnt
// ===============================

// A) Printer polls for job (POST)
app.post("/cloudprnt", (req, res) => {
  console.log("CloudPRNT POST poll received.");

  if (printQueue.length === 0) {
    console.log("No jobs in queue. jobReady = false.");
    return res.json({ jobReady: false });
  }

  const job = printQueue[0];

  const response = {
    jobReady: true,
    jobToken: job.id,
    jobType: "text",
    url: `https://cashndash-webhook.onrender.com/cloudprnt?jobToken=${job.id}`
  };

  console.log("CloudPRNT POST response:", response);
  return res.json(response);
});

// B) Printer downloads job (GET)
app.get("/cloudprnt", (req, res) => {
  const token = req.query.jobToken;
  console.log("CloudPRNT GET download. jobToken =", token);

  if (!token || printQueue.length === 0 || printQueue[0].id !== token) {
    console.log("No matching job for token:", token);
    return res.status(404).send("No job");
  }

  const job = printQueue[0];
  console.log("Sending job markup for job:", job.id);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.send(job.markup);
});

// C) Printer confirms job printed (DELETE)
app.delete("/cloudprnt", (req, res) => {
  console.log("CloudPRNT DELETE called.");

  if (printQueue.length > 0) {
    const finishedJob = printQueue.shift();
    console.log(
      `Job ${finishedJob.id} printed and removed. Remaining queue: ${printQueue.length}`
    );
  } else {
    console.log("DELETE called but queue is empty.");
  }

  return res.send("OK");
});

// ===============================
// HEALTH CHECK
// ===============================
app.get("/", (_req, res) => {
  res.send("Cash N Dash Webhook Running");
});

// ===============================
// START SERVER
// ===============================
const port = process.env.PORT || 8080;
app.listen(port, () =>
  console.log(`Cash N Dash Webhook running on port ${port}`)
);
