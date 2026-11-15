// Profilen: billede (fra Lectio), navn, oplysninger og et overblik over dine egne sider.
// getMe(), apiGet() og logout() kommer fra session.js.

function initials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    return (words[0][0] + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase();
}

// Billedet hentes fra vores server, som henter det fra Lectio. Mangler det, vises initialerne.
function loadAvatar() {
    // Både profilbilledet og studiekortet bruger billedet
    for (const [imageId, initialsId] of [["#avatarImage", "#avatarInitials"], ["#cardImage", "#cardInitials"]]) {
        const image = document.querySelector(imageId);
        const initials = document.querySelector(initialsId);

        image.addEventListener("load", () => {
            image.hidden = false;
            initials.hidden = true;
        });
        image.addEventListener("error", () => {
            image.hidden = true;
            initials.hidden = false;
        });

        image.src = "/api/profil/billede";
    }
}

async function showProfile() {
    const me = await getMe();
    const student = me.student ?? {};

    document.querySelector("#profileName").textContent = student.name || "Profil";
    document.querySelector("#avatarInitials").textContent = initials(student.name);
    document.querySelector("#profileSub").textContent = [student.className, student.schoolName].filter(Boolean).join(" · ");

    const source = me.demo ? "Demo-data" : "Lectio";
    document.querySelector("#chipSource").label = source;
    document.querySelector("#profileSource").textContent = me.demo ? "Demo-data (JSON-filer)" : "Lectio (hentes live)";
    document.querySelector("#profileClass").textContent = student.className || "-";
    document.querySelector("#profileSchool").textContent = student.schoolName || "-";

    if (student.schoolName) {
        const chip = document.querySelector("#chipSchool");
        chip.label = student.schoolName;
        chip.hidden = false;
    }

    // Studiekortet
    document.querySelector("#cardName").textContent = student.name || "";
    document.querySelector("#cardInitials").textContent = initials(student.name);
    document.querySelector("#cardClass").textContent = student.className || "";
    document.querySelector("#cardSchool").textContent = student.schoolName || "";
    document.querySelector("#cardId").textContent = student.studentId || (me.demo ? "demo" : "-");

    loadAvatar();
}


/* ---------- Overblik ---------- */

// Hvert tal hentes for sig, så en fejl ét sted ikke tager de andre med
async function showStat(id, load) {
    try {
        document.querySelector(id).textContent = await load();
    } catch {
        document.querySelector(id).textContent = "–";
    }
}

function loadStats() {
    showStat("#statNotes", async () => (await apiGet("/api/noter")).notes.length);

    showStat("#statTasks", async () =>
        (await apiGet("/api/opgaver")).assignments.filter(item => item.status === "missing").length);

    showStat("#statAbsence", async () => {
        const { teams } = await apiGet("/api/fravaer");
        const total = teams.find(team => /^(samlet|i alt)/i.test(team.name)) ?? teams[0];
        return total.year.pct.replace(/\s/g, "").replace("%", " %");
    });

    showStat("#statMessages", async () => (await apiGet("/api/beskeder")).messages.length);
}

document.querySelector("#logoutButton").addEventListener("click", logout);

showProfile();
loadStats();
