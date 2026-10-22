const express = require("express");
const path = require("path");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

app.disable("x-powered-by");

app.get("/healthz", (_request, response) => {
    response.type("text/plain").send("ok");
});

app.use("/api", require("./api"));
app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(PORT, HOST, () => {
    console.log(`Server kører på http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
