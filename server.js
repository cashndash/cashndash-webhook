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
      try { args = JSON.parse(args); } catch { args = { markup: args }; }
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
        const rawMarkup =
          args.markup ?? args.content ?? args.text ?? args.items ?? "";

        if (!rawMarkup) {
          results.push({ toolCallId, result: "missing_markup" });
          continue;
        }

        // IMPORTANT: you asked to NOT include store name/timestamp from Vapi
        const cleaned = String(rawMarkup).trim();

        // Send to StarIO with timeout guard
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        const response = await fetch(STAR_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "text/vnd.star.markup",
            "Star-Api-Key": STAR_API_KEY
          },
          body: cleaned,
          signal: controller.signal
        });

        clearTimeout(timeout);

        const starText = await response.text();

        if (!response.ok) {
          results.push({ toolCallId, result: `star_error_${response.status}` });
        } else {
          results.push({ toolCallId, result: "printed" });
        }
        continue;
      }

      // Unknown tool (still return something so Vapi doesn't hang)
      results.push({ toolCallId, result: `unknown_tool_${toolName}` });
    } catch (err) {
      results.push({
        toolCallId,
        result: err?.name === "AbortError" ? "printer_timeout" : "server_error"
      });
    }
  }

  return res.status(200).json({ results });
});
