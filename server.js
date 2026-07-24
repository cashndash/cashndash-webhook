import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.text({ type: "*/*" }));   // Accept raw text

// Your StarIO.Online print endpoint
const STAR_ENDPOINT = "https://api.stario.online/v1/a/CASHNDASH/d/bcb6e3f3/q";

// Your StarIO.Online API Key (DO NOT share this publicly)
const STAR_API_KEY = process.env.STAR_API_KEY;

app.post("/print", async (req, res) => {
  try {
    const markup = req.body;  // Raw Star Markup text

    const response = await fetch(STAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/vnd.star.markup",
        "Star-Api-Key": STAR_API_KEY
      },
      body: markup
    });

    const text = await response.text();
    res.status(200).send({ ok: true, starResponse: text });
  } catch (err) {
    res.status(500).send({ ok: false, error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Cash N Dash Webhook Running");
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Webhook running on port ${port}`));
