require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const db = require("./db/db");
const saleRoutes = require("./routes/sale");

const app = express();
app.use(cors());
app.use(express.json());

// Serve generated bill images statically so they can be viewed/shared
app.use("/bills", express.static(path.join(__dirname, "..", "generated_bills")));

app.use("/api", saleRoutes);

app.get("/", (req, res) => {
  res.json({ status: "AI Business Assistant backend is running" });
});

const PORT = process.env.PORT || 3000;

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
