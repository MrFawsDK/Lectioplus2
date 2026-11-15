// Fraværssiden bygger på Lectios fraværsside: opgjort fravær, hele året, fravær pr. hold
// og de moduler hvor man har haft fravær (med eller uden årsag).

const WARN = 5;      // % - fra her bør man holde øje med det
const HIGH = 10;     // % - fra her er det højt
const CRITICAL = 20; // % - fra her er det kritisk

// Farver til cirkeldiagrammet (et hold pr. farve)
const COLORS = ["#4285f4", "#34a853", "#fbbc04", "#ea4335", "#9c27b0", "#00acc1", "#ff7043", "#8d6e63", "#5c6bc0", "#7cb342"];

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const number = text => {
    const match = String(text ?? "").replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
    return match ? Number(match[0].replace(",", ".")) : 0;
};

const format = value => `${value.toFixed(1).replace(".", ",")} %`;
const isTotal = team => /^(samlet|i alt)/i.test(team.name);

function level(pct) {
    if (pct >= CRITICAL) return { name: "Kritisk", color: "var(--bad)" };
    if (pct >= HIGH) return { name: "Højt", color: "var(--bad)" };
    if (pct >= WARN) return { name: "Moderat", color: "var(--warn)" };
    return { name: "Lavt", color: "var(--ok)" };
}

function modulesText(count) {
    return `${count} modul${count === 1 ? "" : "er"}`;
}

function when(module) {
    const date = module.date ? module.date.split("-").reverse().join("/") : "";
    return [module.week, date, module.start && `${module.start}–${module.end}`].filter(Boolean).join(" · ");
}


/* ---------- Opgjort og hele året ---------- */

function renderTotals(total) {
    const period = number(total.period.pct);
    const year = number(total.year.pct);

    document.querySelector("#periodPct").textContent = format(period);
    document.querySelector("#periodModules").textContent = modulesText(number(total.period.modules));
    document.querySelector("#yearPct").textContent = format(year);
    document.querySelector("#yearModules").textContent = modulesText(number(total.year.modules));
}

function renderDiagnosis(total, teams) {
    const pct = number(total.period.pct);
    const { name, color } = level(pct);
    const worst = [...teams].sort((a, b) => number(b.period.pct) - number(a.period.pct))[0];
    const high = teams.filter(team => number(team.period.pct) >= HIGH);
    const clean = teams.filter(team => number(team.year.modules) === 0);
    const insights = [];

    if (pct < WARN) insights.push("Dit opgjorte fravær er lavt. Fortsæt som du gør.");
    else if (pct < HIGH) insights.push(`Du er under ${HIGH} %, men tæt nok på til, at du bør holde øje med det.`);
    else insights.push(`Du er over ${HIGH} %. Tal med dine lærere eller din studievejleder, hvis fraværet skyldes noget bestemt.`);

    if (worst && number(worst.period.pct) >= WARN) insights.push(`Mest fravær har du i ${worst.name} (${format(number(worst.period.pct))}).`);
    if (high.length > 1) insights.push(`${high.length} hold ligger over ${HIGH} %: ${high.map(team => team.name).join(", ")}.`);
    if (clean.length) insights.push(`Intet fravær i hele året: ${clean.map(team => team.name).join(", ")}.`);

    document.querySelector("#verdict").innerHTML =
        `<span class="badge" style="background:${color}">${name}</span>`;
    document.querySelector("#insights").innerHTML = insights.map(text => `<li>${escapeHtml(text)}</li>`).join("");
}


/* ---------- Cirkeldiagram og tabel pr. hold ---------- */

function renderTeams(teams) {
    const sorted = teams
        .map(team => ({ ...team, count: number(team.year.modules), pct: number(team.year.pct) }))
        .sort((a, b) => b.count - a.count);

    const sum = sorted.reduce((total, team) => total + team.count, 0);
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    document.querySelector("#donut").innerHTML = sum === 0
        ? `<circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--md-sys-color-surface-container-high)" stroke-width="14"></circle>`
        : sorted.filter(team => team.count > 0).map((team, index) => {
            const length = circumference * team.count / sum;
            const slice = `<circle cx="60" cy="60" r="${radius}" fill="none" stroke="${COLORS[sorted.indexOf(team) % COLORS.length]}" stroke-width="14"
                stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"><title>${escapeHtml(team.name)}: ${team.count}</title></circle>`;
            offset += length;
            return slice;
        }).join("");

    document.querySelector("#donutTotal").textContent = sum;

    const max = sorted[0]?.count || 1;
    document.querySelector("#teamBody").innerHTML = sorted.map((team, index) => `
        <tr>
            <th scope="row"><i class="dot" style="background:${COLORS[index % COLORS.length]}"></i>${escapeHtml(team.name)}</th>
            <td>${escapeHtml(team.year.pct)}</td>
            <td><div class="mini-bar"><div style="width:${team.count / max * 100}%"></div></div></td>
            <td class="right">${modulesText(team.count)}</td>
        </tr>`).join("");
}


/* ---------- Moduler med fravær ---------- */

function renderModules(missing, registered) {
    const row = (module, cells) =>
        `<tr><th scope="row">${escapeHtml(module.subject || module.title || "Modul")}</th><td>${escapeHtml(when(module))}</td>${cells}</tr>`;

    document.querySelector("#missingTitle").textContent = `Manglende fraværsårsager: ${missing.length}`;
    document.querySelector("#missingGroup").hidden = missing.length === 0;
    document.querySelector("#missingBody").innerHTML = missing.map(module =>
        row(module, `<td>${escapeHtml(module.absence)}</td><td>${escapeHtml(module.type)}</td>`)).join("");

    document.querySelector("#registeredTitle").textContent = `Fraværsårsager angivet: ${registered.length}`;
    document.querySelector("#registeredGroup").hidden = registered.length === 0;
    document.querySelector("#registeredBody").innerHTML = registered.map(module =>
        row(module, `<td>${escapeHtml(module.absence)}</td><td>${escapeHtml(module.reason)}</td><td>${escapeHtml(module.reasonNote)}</td>`)).join("");
}


/* ---------- Start ---------- */

function render({ teams, missing = [], registered = [] }) {
    const total = teams.find(isTotal) ?? teams[0];
    const subjects = teams.filter(team => !isTotal(team));

    renderTotals(total);
    renderDiagnosis(total, subjects);
    renderTeams(subjects);
    renderModules(missing, registered);

    document.querySelector("#emptyState").hidden = true;
    document.querySelector("#content").hidden = false;
}

async function loadAbsence() {
    try {
        render(await apiGet("/api/fravaer"));
    } catch (error) {
        document.querySelector("#emptyText").textContent = error.message;
    }
}

loadAbsence();
