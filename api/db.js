// Flexios database (SQLite): data/flexio.db, eller DATA_DIR/flexio.db hvis DATA_DIR er sat (fx et Docker-volume).
// Bruges af index.js (sessioner) og noter.js (noter, tags, deling og brugere).

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "flexio.db"));

// WAL: læsning og skrivning blokerer ikke hinanden, og et gem er sikkert på disken, når kaldet er færdigt
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");

module.exports = db;
