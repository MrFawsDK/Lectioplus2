# Kodeforklaring til Teknologi B

Vi har lavet studieplatformen Flexio med HTML, CSS og JavaScript i browseren og Node.js med Express på serveren. Vi henter elevdata fra Lectios sider og gemmer vores egne noter i en SQLite-database.

Forklaringerne bygger på projektets nuværende kode. Kodeuddragene er kopieret fra filerne; indrykningen er enkelte steder fjernet, så de er lettere at læse. Filstierne er fra projektets rodmappe. Vi beskriver, hvad koden gør, uden at påstå, at funktionerne er afprøvet mod Lectio.

## Overblik over projektet

| Placering | Hvad vi bruger den til |
| --- | --- |
| `server.js` | Starter webserveren og sender sider og API-kald videre. |
| `api/index.js` | Login, sessioner og adgang til elevdata. |
| `api/lectio.js` | Henter Lectio-sider og læser oplysninger fra deres HTML. |
| `api/db.js` og `api/noter.js` | Database, noter, tags, fag og deling. |
| `public/` | Siderne og den JavaScript og CSS, som browseren bruger. |
| `public/session/` og `public/header/` | Fælles API-kald, login-tjek og navigation. |
| `public/m3/` og `scripts/build-m3.js` | Material-komponenter og scriptet, der samler dem. |
| `public/*/*.json` | Eksempeldata til demoen. |
| `data/flexio.db` | SQLite-filen med platformens gemte data. |
| `Dockerfile` | Opsætning til at køre serveren i Docker. |

Vi har også EJS som afhængighed i `package.json`, men vi har ikke fundet brug af EJS-skabeloner i serverkoden. Siderne bliver leveret som HTML-filer.

## 1. Webserver og API

Vi bruger serveren til både vores egne API-ruter og filerne til hjemmesiden.

**Placering:** `server.js`, fra linje 17.

```js
app.use("/api", require("./api"));
```

Vi sender alle adresser, der begynder med `/api`, til routeren i `api/index.js`. Resten af serverfilen leverer HTML, CSS og JavaScript fra `public/`. Et API er her de adresser, som browseren kalder for at hente eller gemme data. Serveren starter med `app.listen`, og porten er som udgangspunkt 3000.

## 2. Login med Lectio-cookie

Vi lader eleven vælge skole og indsætte en cookie fra en eksisterende Lectio-session.

**Placering:** `api/index.js`, fra linje 125.

```js
const user = { schoolCode, cookie: cookie.replace(/^\s*cookie:\s*/i, "").trim() };

    try {
        // Virker cookien, kan vi se elevens forside
        user.student = await lectio.getStudent(user);
        startSession(res, user);
        res.json({ student: user.student });
```

Vi fjerner et eventuelt `Cookie:` foran teksten. Derefter prøver vi at hente elevens forside med `getStudent`. Hvis det lykkes, opretter vi en Flexio-session. Hvis Lectio afviser cookien, sender vi en fejl tilbage. Vi har altså ikke lavet login med brugernavn og adgangskode. Browserdelen ligger i `public/login/login.js`; den sender skolekode og cookie til `/api/login` og husker kun skolevalget i `localStorage`.

## 3. Sessioner og adgang til API’et

Vi bruger et tilfældigt sessions-id til at genkende eleven efter login.

**Placering:** `api/index.js`, fra linje 73.

```js
function startSession(res, session) {
    const id = crypto.randomBytes(32).toString("hex");
    const { schoolCode, cookie, student, demo } = session;

    sessionSql.deleteOld.run(Date.now() - SESSION_DAYS * DAY);
    sessionSql.insert.run(hashId(id), JSON.stringify({ schoolCode, cookie, student, demo }), Date.now());
    sessions.set(hashId(id), session);
    res.cookie("flexio_session", id, { httpOnly: true, sameSite: "lax", maxAge: SESSION_DAYS * DAY });
}
```

Vi laver id’et med 32 tilfældige bytes. Databasen gemmer en SHA-256-hash af id’et, mens browseren får selve id’et som cookie. `httpOnly` betyder, at JavaScript på siden ikke kan læse denne cookie. `sameSite: "lax"` begrænser, hvornår den sendes med fra andre hjemmesider. Selve Lectio-cookien ligger i sessionens JSON-data på serveren; den er ikke krypteret af denne kode.

Vi kontrollerer sessionen i `requireLogin` i samme fil. Mangler den, svarer API’et med status 401. Vi har sat en grænse på 30 dage, men `last_seen` bliver kun opdateret, når sessionen læses fra databasen, og hukommelsens sessioner bliver returneret uden et nyt udløbstjek. Vi kan derfor ikke beskrive det som et præcist udløb 30 dage efter seneste aktivitet.

## 4. Fælles API-kald og logout

Vi samler hentning af data og håndtering af manglende login ét sted.

**Placering:** `public/session/session.js`, fra linje 24.

```js
if (response.status === 401) {
        goToLogin(data?.code === "not_authenticated" ? "udlobet" : "");
        // Stop koden der kaldte, mens siden skifter
        return new Promise(() => {});
    }
```

Når serveren svarer 401, sender vi eleven til login. `goToLogin` gemmer den aktuelle side i parameteren `next`, så eleven kan komme tilbage bagefter. Det ventende Promise stopper den efterfølgende kode, mens browseren skifter side. `apiSend` i samme fil sender POST, PUT og DELETE med JSON. Ved logout sletter serveren sessionen fra hukommelsen og databasen og fjerner browserens sessions-cookie.

## 5. Hentning af oplysninger fra Lectio

Vi henter Lectios HTML på serveren og læser oplysninger ud af den med Cheerio.

**Placering:** `api/lectio.js`, fra linje 13.

```js
async function getPage(user, page) {
    const response = await fetch(`${LECTIO}/${user.schoolCode}/${page}`, {
        headers: { Cookie: user.cookie },
        redirect: "manual"
    });

    const html = response.status === 200 ? await response.text() : "";

    // Sider for en logget ind bruger har altid et "Log ud"-link
    if (!html.includes("logout.aspx")) throw new NotLoggedInError();

    return html;
}
```

Vi sender elevens Lectio-cookie i forespørgslen. `redirect: "manual"` betyder, at vi ikke automatisk følger en viderestilling til login. Vi leder derefter efter `logout.aspx` i HTML’en som tegn på en gyldig session. Det er vores kontrol i koden; den kan også ramme, hvis sidens opbygning ændres. Vi bruger `cheerio.load` i de efterfølgende funktioner til at finde tabeller, links og skemabrikker. Koden bruger web-scraping af Lectios sider, ikke et officielt Lectio-API.

## 6. SQLite-databasen

Vi gemmer noter og sessioner i en databasefil på serveren.

**Placering:** `api/db.js`, fra linje 8.

```js
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "flexio.db"));

// WAL: læsning og skrivning blokerer ikke hinanden, og et gem er sikkert på disken, når kaldet er færdigt
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
```

`DATA_DIR` gør det muligt at vælge en anden mappe til databasen. Ellers bruger vi `data/`. `DatabaseSync` kommer fra Nodes `node:sqlite` og udfører databasekald synkront. WAL gør det muligt for læsning og skrivning at foregå samtidig i flere situationer. `busy_timeout` lader SQLite vente op til fem sekunder, hvis databasen er låst.

Vi opretter tabellerne i `api/index.js` og `api/noter.js`: `sessions`, `notes`, `tags`, `note_recipients` og `users`. En note indeholder blandt andet titel, fag, dato, HTML-indhold og ejer. Tags gemmes som en JSON-liste af id’er i noten. Delinger ligger i deres egen tabel, så en note kan have flere modtagere. Vi har indekser på blandt andet ejer og modtager, som databasen kan bruge ved opslag.

## 7. Ejerskab og databaseopslag

Vi knytter noter til en bestemt elev og skole.

**Placering:** `api/noter.js`, fra linje 126.

```js
function ownerOf(user) {
    if (user.demo) return "demo";

    const { studentId, name } = user.student ?? {};
    const owner = `${user.schoolCode}:${studentId ?? name}`;
```

Vi bruger skolekode og elev-id som ejer. Hvis elev-id mangler, falder vi tilbage på elevens navn. Alle demo-sessioner bruger ejeren `demo`, så de deler de samme noter. Resten af funktionen flytter ældre noter fra navn til elev-id og registrerer eleven i tabellen `users`. Det sker ved kald til `ownerOf`, ikke direkte i login-ruten.

## 8. Oprettelse, redigering og sletning af noter

Vi kan oprette en note, ændre den og slette den igen. Serveren kontrollerer ejeren.

**Placering:** `api/noter.js`, fra linje 400.

```js
router.put("/noter/:id", (req, res) => {
        const owner = ownerOf(req.user);
        if (!sql.note.get(req.params.id, owner)) return res.status(404).json({ error: "Noten findes ikke" });

        sql.updateNote.run({ id: req.params.id, owner, ...noteFields(req.body ?? {}, owner), updated_at: now() });
        res.json(toNote(sql.note.get(req.params.id, owner)));
    });
```

Vi slår først noten op med både id og ejer. Derfor kan vi ikke rette en anden elevs note gennem denne rute ved blot at kende id’et. `noteFields` udvælger og kontrollerer de felter, der må gemmes. SQL-opdateringen bruger også både id og ejer i sin `WHERE`-betingelse. Værdierne sendes som parametre til forberedte SQL-kald, så de ikke bliver sat direkte ind i SQL-teksten.

POST-ruten i samme fil opretter noter og kan genbruge et id fra browseren. Hvis den samme oprettelse sendes igen, opdaterer vi den eksisterende note i stedet for at oprette en dublet. DELETE-ruten sletter noten og dens modtagere. Dato og tid kontrolleres med mønstre, men det er ikke en fuld kontrol af, om datoen findes i kalenderen.

## 9. Automatisk gemning

Vi gemmer noten automatisk efter en pause på 800 millisekunder i skrivningen.

**Placering:** `public/noter/noter.js`, fra linje 624.

```js
function scheduleSave() {
    pendingChanges = true;
    setSaveState("Gemmer …", "unsaved");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, AUTOSAVE_MS);
}
```

Vi nulstiller timeren ved hver ændring. På den måde samler vi flere tastetryk i ét gem. `saveNow` henter felterne og editorens rensede HTML. `queueSave` holder gemningerne i rækkefølge med et Promise og springer ventende data over, hvis der er kommet en nyere udgave. Hver åben note har sin egen `editSession`, så et forsinket svar ikke ændrer editoren for en anden note. Ved netværksfejl og serverfejl prøver vi igen efter tre sekunder.

## 10. Lokal kladde ved problemer med at gemme

Vi gemmer en kladde i browseren, inden vi sender ændringerne til serveren.

**Placering:** `public/noter/noter.js`, fra linje 733.

```js
function writeDraft(session, data) {
    draftData = data;
    writeStorage(DRAFT_KEY, {
        owner: draftOwner,
        noteId: session.noteId,
        newId: session.newId,
        baseUpdatedAt: session.baseUpdatedAt,
        data
    });
}
```

Vi gemmer notens data, id og tidspunktet for den version, kladden bygger på. `restoreDraft` forsøger at gemme kladden, næste gang noterne åbnes. Vi springer den over, hvis noten er slettet eller ændret siden kladden. Kladden er knyttet til et elev-id eller navn, men nøglen indeholder ikke skolekoden. Der ligger kun én kladde under `DRAFT_KEY`, og lagringen kan fejle. Vi kan derfor ikke love, at alle ændringer altid bliver bevaret. Kladden skrives først, når `saveNow` kører, ikke ved hvert tastetryk.

## 11. Teksteditor og formatering

Vi kan skrive noter med blandt andet fed skrift, overskrifter, lister og forskellige skriftstørrelser.

**Placering:** `public/noter/editor.js`, fra linje 192.

```js
function run(command, value = null, withCss = false) {
        restoreSelection();
        document.execCommand("styleWithCSS", false, withCss);
        document.execCommand(command, false, value);
        changed();
    }
```

Selve skrivefeltet er et `contenteditable`-element i `public/noter/index.html`. Vi gemmer markeringen, så vi kan gendanne den, når eleven bruger værktøjslinjen. `document.execCommand` udfører den valgte formatering på teksten. `changed` opdaterer værktøjslinjen og starter autogem gennem den tilknyttede `onChange`-funktion. Indholdet bliver gemt som HTML, så formateringen kan vises igen.

## 12. Rensning af noteindhold

Vi renser HTML fra editoren og delte noter, inden vi bruger den i visningen.

**Placering:** `public/noter/editor.js`, fra linje 128.

```js
function sanitizeHtml(html) {
    // <template> kører ikke scripts eller indlæser billeder, mens vi renser
    const template = document.createElement("template");
    template.innerHTML = html ?? "";
    cleanNode(template.content);
    return template.innerHTML;
}
```

Vi lægger først teksten i et `template`-element. `cleanNode` går derefter igennem indholdet og fjerner blandt andet scripts, iframes og hændelsesattributter. Vi beholder kun udvalgte HTML-tags og styles. Links må begynde med HTTP, HTTPS eller mailto. Funktionen bruges ved indsættelse, ved åbning og når vi henter HTML fra editoren.

Rensningen ligger i browseren. Serverens `noteFields` begrænser indholdets længde, men kalder ikke denne HTML-rensning. Vi kan derfor ikke beskrive det som en kontrol, der også udføres på serveren.

## 13. Søgning, filtre og tags

Vi kan finde noter ud fra fag, tags og tekst og gruppere dem på flere måder.

**Placering:** `public/noter/noter.js`, fra linje 235.

```js
const haystack = [note.title, noteText(note), note.subject, ...tagsOf(note).map(tag => tag.name)]
            .join(" ")
            .toLowerCase();

        return haystack.includes(search);
```

Vi samler titel, indhold, fag og tagnavne til én søgetekst og laver den om til små bogstaver. `includes` finder søgningen i teksten. Resten af `visibleNotes` filtrerer på fag og kræver mindst ét af de valgte tags. `groupsFor` og `buildGroups` samler noterne efter fag, tag, uge, dato eller lektion.

Vi opretter og retter tags gennem `/api/tags` i `api/noter.js`. Hvert tag har navn, farve og ikon. Serveren accepterer kun farver fra sin liste og tags, der tilhører eleven. Når vi sletter et tag, fjerner vi også dets id fra elevens noter. Farver og ikoner til brugerfladen ligger i `public/noter/tags.js`.

## 14. Fag og hold

Vi finder fag ud fra elevens skema og fag, der allerede bruges i noter.

**Placering:** `api/noter.js`, fra linje 610.

```js
const subjects = [...new Set([...fromLectio, ...used].filter(Boolean))].sort((a, b) => a.localeCompare(b, "da"));
        res.json({ subjects });
```

Vi samler de to lister og fjerner tomme værdier med `filter(Boolean)`. `Set` fjerner dubletter, og `localeCompare` sorterer med dansk sprogregel. `lectioTeams` i samme fil undersøger denne uge og de tre foregående uger og gemmer holdlisten i sessionens hukommelse i en time.

Vi har ikke en selvstændig fagtabel eller en funktion til at oprette fag i Lectio. Faglisten bruger holdnavne fra skemaet. Et hold kan derfor mangle, hvis det ikke optræder i de fire undersøgte uger. Ruterne `/api/hold` og `/api/hold/:id/elever` kan også hente hold og deltagere; deltagerlisten kræver, at holdet findes i elevens egen holdliste.

## 15. Deling med andre elever

Vi kan søge efter andre Flexio-brugere på samme skole og give dem læseadgang til en note.

**Placering:** `api/noter.js`, fra linje 489.

```js
const target = `${schoolOf(req.user)}:${String(item.id)}`;
                const student = req.user.demo
                    ? DEMO_STUDENTS.find(entry => entry.id === String(item.id))
                    : sql.user.get(target);
                if (student && target !== owner) recipients.set(target, { kind: "student", target, name: student.name, team_id: null });
```

Vi danner modtagerens nøgle med afsenderens skolekode og det valgte elev-id. Navnet hentes fra databasen, så vi ikke stoler på et navn sendt fra browseren. Vi tilføjer kun en modtager, som findes, og udelukker afsenderen selv. `Map` forhindrer dubletter. Søgeruten `/api/brugere` søger i navn og klasse og giver højst 20 resultater. Elever bliver registreret gennem `ownerOf`, når de bruger de tilknyttede API-ruter.

Hele modtagerlisten erstattes i en databasetransaktion med `BEGIN`, `COMMIT` og `ROLLBACK`. Så bliver listen enten gemt samlet eller rullet tilbage ved en fejl. Browserens delingsdialog og søgning ligger i `public/noter/noter.js`.

Vi har rester af holddeling i databasen og API’et. Den nuværende PUT-rute kan kun beholde eller fjerne et hold, der allerede er modtager. Vi kan ikke tilføje en ny holddeling gennem denne kode. Felterne `share_token` og `shared_by` findes også i notetabellen, men vi har ikke fundet en aktiv rute, der opretter offentlig linkdeling.

## 16. Modtagelse og kopiering af delte noter

Vi viser modtagne noter under “Delt med dig”. Modtageren kan åbne dem eller gemme en egen kopi.

**Placering:** `api/noter.js`, fra linje 512.

```js
async function receivedNotes(user) {
        const rows = sql.sharedWithMe.all(JSON.stringify(await myTargets(user)), ownerOf(user));
        const byId = new Map();
        rows.forEach(row => {
            if (!byId.has(row.id) || row.kind === "student") byId.set(row.id, row);
        });
        return [...byId.values()];
    }
```

Vi finder de noter, som er delt med eleven eller elevens hold. SQL-kaldet forbinder `note_recipients` med `notes`, så vi henter notens aktuelle indhold. `Map` sørger for, at samme note kun vises én gang, selv hvis der er flere delinger til eleven. Det betyder ikke, at siden opdaterer løbende uden genindlæsning.

`public/delt/delt.js` henter en bestemt delt note og viser den med `sanitizeHtml`. API’et kontrollerer adgangen igen, når noten åbnes eller kopieres. `copyNote` opretter en ny note med nyt id og modtageren som ejer. Kopien får ingen af afsenderens tags eller delinger, og en tilknyttet lektion bliver heller ikke kopieret. Vi redigerer altså vores egen kopi, hvis vi vil arbejde videre med teksten.

## 17. Skema og moduloplysninger fra Lectio

Vi henter en uge ad gangen og læser modulets navn og tidsrum fra Lectios skema.

**Placering:** `api/lectio.js`, fra linje 143.

```js
const modules = [];
    $(".s2module-info").each((_, element) => {
        const [name, times] = ($(element).html() ?? "").split(/<br\s*\/?>/i).map(part => clean(cheerio.load(part).text()));
        const match = times?.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        if (match && !modules.some(module => module.name === name)) {
            modules.push({ name, start: padTime(match[1]), end: padTime(match[2]) });
        }
    });
```

Vi finder moduloplysningerne med CSS-vælgeren `.s2module-info`. Vi deler HTML’en ved linjeskiftet `<br>`, så vi får modulnavn og tidsrum hver for sig. Et regulært udtryk finder start- og sluttid. `padTime` giver for eksempel `08:00` i stedet for `8:00`, og `some` forhindrer gentagne modulnavne.

I samme funktion læser vi hver skemabrik gennem dens `data-tooltip`. Herfra finder vi dato, tider, hold, lærere, lokaler, lektier og noter. Vi læser også CSS-klasserne for at skelne mellem normale, ændrede og aflyste lektioner. Modulerne er tidsbånd i skemaet; de er ikke JavaScript-moduler eller selvstændige poster i vores database.

## 18. Placering af lektioner i skemaet

Vi tegner lektionerne efter deres tid og længde og fordeler overlap side om side.

**Placering:** `public/skema/skema.js`, fra linje 196.

```js
card.style.top = `${(start - range.start) * SCALE + 2}px`;
    card.style.height = `${(end - start) * SCALE - 4}px`;
    card.style.left = `calc(${(column / columns) * 100}% + 4px)`;
    card.style.width = `calc(${100 / columns}% - 8px)`;
```

Vi omregner først klokkeslæt til minutter. Den øverste placering afhænger af forskellen mellem lektionens start og skemaets start. Højden afhænger af varigheden. `SCALE` er 1,1 pixel pr. minut, og de små fradrag giver luft mellem kortene. `layoutDay` fordeler overlappende lektioner i kolonner, som bestemmer venstre placering og bredde.

Siden har uge- og dagsvisning samt knapper til forrige, næste og i dag. `showWeek` henter data fra `/api/skema`, og `loadedWeeks` husker hentede uger, mens siden er åben. De bliver ikke automatisk hentet igen ved et almindeligt skift tilbage til samme uge.

## 19. Noter knyttet til en lektion

Vi forbinder noter og skema, så vi kan åbne eller oprette en note fra en lektion.

**Placering:** `public/skema/skema.js`, fra linje 458.

```js
function notesFor(lesson) {
    return scheduleNotes.filter(note => note.lesson?.date === lesson.date && note.lesson?.start === lesson.start);
}
```

Vi matcher dato og starttid med notens `lesson`-felt. I `renderLessonNotes` laver vi links til eksisterende noter og et link til en ny note med dato, starttid og fag i adressen. `route` i `public/noter/noter.js` læser oplysningerne og udfylder editoren.

Vi bruger ikke et unikt lektions-id. To lektioner med samme dato og starttid kan derfor få vist de samme tilknyttede noter. Vi kan beskrive forbindelsen som et match på tidspunkt, men ikke som en entydig reference til en bestemt skemabrik.

## 20. Karakterblad og gennemsnit

Vi viser elevens karakterer og beregner et gennemsnit af én tal-karakter pr. fag.

**Placering:** `public/karakter/karakter.js`, fra linje 35.

```js
function latestNumeric(subject, types) {
    const grades = subject.grades
        .filter(item => NUMERIC.includes(item.grade))
        .sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type));

    return grades.length ? Number(grades.at(-1).grade) : null;
}
```

Vi beholder kun karakterer fra 7-trinsskalaen og sorterer efter karaktertypernes rækkefølge i karakterbladet. Vi vælger den sidste tal-karakter i denne rækkefølge. Derefter lægger `renderGrades` de valgte tal sammen og dividerer med antallet. Fag uden tal-karakter tæller ikke med, og alle de valgte fag vejer lige meget.

“Nyeste” betyder her den karakter, der står længst til højre i karakterbladets rækkefølge. Vi sammenligner ikke datoer og beregner ikke et vægtet eksamensgennemsnit. Serverens `getGrades` i `api/lectio.js` læser karaktertabellen og bruger et regulært udtryk til at genkende karakteren i starten af en celle. `public/karakter/karakter.css` slører karaktererne, indtil man peger, fokuserer eller trykker på dem. Tallene er stadig sendt til browseren.

## 21. Opgaver og afleveringer

Vi giver overblik over opgaver, status og resterende elevtid.

**Placering:** `public/opgaver/opgaver.js`, fra linje 151.

```js
const missing = list.filter(item => statusOf(item) === "missing").length;
    const submitted = list.filter(item => statusOf(item) === "submitted").length;
    const upcoming = list.filter(item => statusOf(item) === "pending");
    const hoursLeft = upcoming.reduce((sum, item) => sum + (item.hours ?? 0), 0);
```

Vi deler opgaverne op efter deres status fra Lectio og tæller grupperne. `reduce` lægger elevtiden sammen for opgaver med status `pending`. Vi kan filtrere efter hold, aktuelle opgaver og skoleår. Afleverede opgaver regnes kun som aktuelle, hvis fristen ligger højst 90 dage tilbage. Opgaver, der venter eller mangler, regnes altid som aktuelle i dette filter.

`getAssignments` i `api/lectio.js` finder kolonner ud fra tabellens overskrifter og læser blandt andet titel, frist, elevtid og status. Vi viser oplysningerne; vi har ikke fundet en funktion til at uploade afleveringer eller ændre deres status i Lectio.

## 22. Demo uden Lectio-login

Vi kan vise platformen med eksempeldata uden en Lectio-cookie.

**Placering:** `api/index.js`, fra linje 116.

```js
if (demo === true) {
        const student = { name: "Demo-elev", className: "Demo", schoolName: "Demo-skole" };
        startSession(res, { demo: true, student });
        return res.json({ student });
    }
```

Vi opretter en session med en demo-elev. API-ruterne for skema, opgaver og karakterer læser derefter JSON-filerne i de tilsvarende mapper under `public/`. Noterne fungerer anderledes: `seedDemo` i `api/noter.js` importerer eksempelnoter til databasen, hvis demo-ejeren hverken har noter eller tags. Demoens modtagernavne er opdigtede, og delinger med dem når ikke frem til rigtige elever. Alle demo-sessioner deler de gemte demonoter.

## 23. Profil og fælles navigation

Vi viser elevens navn, klasse og skole og genbruger den samme topmenu på siderne.

**Placering:** `public/header/header.js`, fra linje 17.

```js
const response = await fetch("/header/header.html");
    header.innerHTML = await response.text();
```

Vi henter menuens HTML fra én fælles fil. Derefter ændrer `loadHeader` knaptypen for den aktive side og viser navn og eventuelt demo-mærke fra `getMe`. Profilens visning ligger i `public/profil/profil.js` og bruger også `getMe`. Vi kan se profilen og logge ud, men der er ikke kode til at ændre elevens profiloplysninger.

## 24. Genbrug af Material-komponenter

Vi bruger færdige Material Web-komponenter til blandt andet knapper, felter og dialoger.

**Placering:** `public/m3/komponenter.js`, fra linje 28.

```js
import "@material/web/chips/chip-set.js";    // <md-chip-set>
import "@material/web/chips/assist-chip.js"; // <md-assist-chip>
import "@material/web/chips/filter-chip.js"; // <md-filter-chip>
```

Vi importerer de komponenter, som siderne bruger. `scripts/build-m3.js` samler dem med esbuild i `public/m3/material.js`, som HTML-siderne indlæser. Den store fil indeholder også bibliotekernes kode og er genereret; den er ikke vores egen håndskrevne funktionalitet. Vi bruger HTML til sidernes indhold og CSS til udseende og tilpasning til skærmstørrelsen. Noter kan desuden printes med `window.print`, og `@media print` i `public/noter/noter.css` styrer printvisningen.

## 25. Opdaterede filer og drift

Vi giver JavaScript- og CSS-filer en versionsværdi og kan køre serveren i Docker.

**Placering:** `server.js`, fra linje 31.

```js
const hash = crypto.createHash("sha256");
for (const file of publicFiles(PUBLIC_DIR).sort()) hash.update(file).update(fs.readFileSync(file));
const VERSION = hash.digest("hex").slice(0, 10);
```

Vi beregner en hash af filstier og indhold i `public/`, når serveren starter. `versionedPage` føjer værdien til lokale JavaScript- og CSS-adresser som `?v=...`. Dermed får filerne nye adresser efter en ændring og genstart, så browseren kan hente den nye udgave. Beregningen kører ikke løbende, mens serveren er startet.

`Dockerfile` bruger Node 22 Alpine, installerer produktionsafhængigheder og starter `server.js` som brugeren `node`. Vi har angivet `/app/data` som volume til databasen. Ved at tilknytte et vedvarende volume kan vi bevare data, når vi udskifter containeren. `/healthz` svarer med `ok` og bruges som kontrol af, om webserveren svarer; den kontrollerer ikke Lectio-forbindelsen.

## Afgrænsning

Vi har gennemgået platformens serverkode, API-ruter, browserkode, HTML, CSS, demodata og opsætning. Vi har brugt kildekoden til Material-komponenternes imports og byggescript til at skelne mellem vores funktioner og genereret bibliotekskode. Vi har ikke brugt indhold fra den eksisterende database som dokumentation for bestemte elevers data.

Vi har ikke fundet automatiske tests eller et test-script i `package.json`. Denne gennemgang dokumenterer koden, men er ikke en afprøvning af login eller datahentning mod Lectio. Hvis Lectio ændrer sin HTML, kan de dele af platformen, der læser siderne, kræve ændringer.
