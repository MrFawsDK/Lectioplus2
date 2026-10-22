// Viser hvem der er logget ind (getMe() og logout() kommer fra session.js)

async function showProfile() {
    const me = await getMe();
    const student = me.student ?? {};

    document.querySelector("#profileName").textContent = student.name || "Profil";
    document.querySelector("#profileLead").textContent = me.demo
        ? "Du bruger demo-data. Log ud og log ind med Lectio for at se dine egne data."
        : "Logget ind via Lectio.";
    document.querySelector("#profileClass").textContent = student.className || "-";
    document.querySelector("#profileSchool").textContent = student.schoolName || "-";
    document.querySelector("#profileSource").textContent = me.demo ? "Demo-data (JSON-filer)" : "Lectio (hentes live)";
}

document.querySelector("#logoutButton").addEventListener("click", logout);

showProfile();
