import express from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import { config, isProduction } from "./config.js";
import { createRouter } from "./routes.js";

const app = express();

app.set("trust proxy", 1);

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: config.frontendOrigin,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"]
}));

app.use(express.json({ limit: "2mb" }));

app.use(session({
  name: "gv.sid",
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: isProduction() ? "none" : "lax",
    secure: isProduction(),
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(createRouter());

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: isProduction() ? "Server error" : error.message
  });
});

app.listen(config.port, () => {
  console.log(`Gaussian Viewer backend listening on http://localhost:${config.port}`);
});
