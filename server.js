const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

app.disable("x-powered-by");

app.get("/healthz", (_request, response) => {
    response.type("text/plain").send("ok");
});

app.use("/api", require("./api"));

/* ---------- Sider med versionerede filer ---------- */

// Browsere (og Cloudflare) gemmer .js og .css i flere timer. Får en browser ny HTML men gammel JS,
// går siden i stykker. Derfor får alle /x.js og /x.css i HTML'en ?v=<version>, og versionen skifter,
// når en fil i public/ ændres - så henter browseren de nye filer med det samme.
function publicFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? publicFiles(file) : [file];
    });
}

const hash = crypto.createHash("sha256");
for (const file of publicFiles(PUBLIC_DIR).sort()) hash.update(file).update(fs.readFileSync(file));
const VERSION = hash.digest("hex").slice(0, 10);

const pages = new Map(); // sti -> HTML med versioner

function versionedPage(file) {
    if (!pages.has(file)) {
        const html = fs.readFileSync(file, "utf8")
            .replace(/(\s(?:src|href)=")(\/[^"?#]+\.(?:js|css))"/g, `$1$2?v=${VERSION}"`);
        pages.set(file, html);
    }
    return pages.get(file);
}

app.get(/\/$|\.html$/, (request, response, next) => {
    const file = path.join(PUBLIC_DIR, path.normalize(decodeURIComponent(request.path)), request.path.endsWith("/") ? "index.html" : "");
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file)) return next();

    response.set("Cache-Control", "no-cache").type("html").send(versionedPage(file));
});

// Filer med ?v= ændrer sig aldrig og må gemmes længe. Uden ?v= skal browseren spørge serveren hver gang.
app.use(express.static(PUBLIC_DIR, {
    setHeaders(response) {
        response.req.query.v
            ? response.set("Cache-Control", "public, max-age=31536000, immutable")
            : response.set("Cache-Control", "no-cache");
    }
}));

const server = app.listen(PORT, HOST, () => {
    console.log(`Server kører på http://${HOST}:${PORT} (version ${VERSION})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
