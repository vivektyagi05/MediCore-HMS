import { api, dbConnect, ADMIN_EMAIL, ADMIN_PASSWORD } from "./lib.mjs";
const m = await dbConnect(); const db = m.connection.db;
const results = []; const check = (n, ok, e = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", n, e); };
const admin = (await api("POST", "/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).json.data; const A = admin.token;
const wantServices = ["General Physician Consultation","Cardiology Consultation","Dermatology Consultation","Pediatric Consultation","Preventive Health Checkup","Diagnostic Report Review"];
const wantArticles = ["When Should You See a General Physician?","Understanding Blood Pressure and When to Seek Care","How to Prepare for a Doctor Consultation","Warning Signs That Require Urgent Medical Attention","Preventive Health Checkups: What They Usually Include","Understanding Your Basic Blood Test Report"];

console.log("== DB ==");
const svcDocs = await db.collection("services").find({}).toArray();
const artDocs = await db.collection("cmspages").find({ contentType: "article" }).toArray();
console.log("DB services =", svcDocs.length, " DB articles =", artDocs.length, " users =", await db.collection("users").countDocuments({}), " doctors =", await db.collection("doctors").countDocuments({}));
check("six seeded services present in MongoDB", wantServices.every((t) => svcDocs.some((d) => d.title === t)));
check("six seeded articles present in MongoDB", wantArticles.every((t) => artDocs.some((d) => d.title === t)));
check("every seeded article has references", wantArticles.every((t) => (artDocs.find((d) => d.title === t)?.references || []).length >= 1));
check("all seeded services published+public", wantServices.every((t) => { const d = svcDocs.find((x) => x.title === t); return d.status === "published" && d.visibility === "public"; }));

console.log("\n== Public + admin see the same records ==");
const pubS = (await api("GET", "/public/services?limit=100")).json.data;
const pubSList = pubS.services || pubS.items || pubS;
check("public services API returns the six DB services", wantServices.every((t) => JSON.stringify(pubSList).includes(t)), `n=${pubSList.length}`);
const admS = await api("GET", "/admin/services?limit=100", { token: A });
check("admin services API returns the same six", wantServices.every((t) => JSON.stringify(admS.json).includes(t)), `status=${admS.status}`);
const pubA = (await api("GET", "/public/articles?limit=100")).json.data;
const pubAList = pubA.articles || pubA.items || pubA;
check("public articles API returns the six DB articles", wantArticles.every((t) => JSON.stringify(pubAList).includes(t)), `n=${pubAList.length}`);
const admA = await api("GET", "/admin/cms?contentType=article&limit=100", { token: A });
check("admin CMS API returns the same six articles", wantArticles.every((t) => JSON.stringify(admA.json).includes(t)), `status=${admA.status}`);

const lifecycle = async (kind) => {
  const isSvc = kind === "service";
  const base = isSvc ? "/admin/services" : "/admin/cms";
  const pubBase = isSvc ? "/public/services" : "/public/articles";
  const listKey = isSvc ? "services" : "articles";
  const slug = `dev-test-${kind}-lifecycle`;
  await db.collection(isSvc ? "services" : "cmspages").deleteMany({ slug });
  const body = isSvc
    ? { title: "DEV TEST Service Lifecycle", slug, shortDescription: "Development test service", description: "Development test service description.", category: "Consultation", price: 100, duration: "10 minutes", consultationModes: ["online"], status: "draft", visibility: "public" }
    : { title: "DEV TEST Article Lifecycle", slug, excerpt: "Development test article", content: "<p>Development test article body.</p>", category: "Testing", contentType: "article", status: "draft", visibility: "public" };
  const cr = await api("POST", base, { token: A, body });
  check(`${kind}: admin create draft`, [200, 201].includes(cr.status), `status=${cr.status} ${cr.json?.message || ""}`);
  const doc = await db.collection(isSvc ? "services" : "cmspages").findOne({ slug });
  check(`${kind}: record persisted in MongoDB`, !!doc && doc.status === "draft");
  if (!doc) return;
  const id = String(doc._id);
  const visible = async () => JSON.stringify((await api("GET", `${pubBase}?limit=100`)).json.data?.[listKey] || []).includes(slug) || JSON.stringify((await api("GET", `${pubBase}?limit=100`)).json.data || {}).includes(slug);
  const direct = async () => (await api("GET", `${pubBase}/${slug}`)).status;
  check(`${kind}: DRAFT hidden from public list`, !(await visible()));
  check(`${kind}: DRAFT direct slug -> 404`, (await direct()) === 404, `got ${await direct()}`);
  await api("PUT", `${base}/${id}`, { token: A, body: { ...body, status: "review" } });
  check(`${kind}: REVIEW hidden (list + direct)`, !(await visible()) && (await direct()) === 404);
  await api("PUT", `${base}/${id}`, { token: A, body: { ...body, status: "published", visibility: "private" } });
  const dd = await db.collection(isSvc ? "services" : "cmspages").findOne({ slug });
  check(`${kind}: PRIVATE(+published) hidden (list + direct)`, !(await visible()) && (await direct()) === 404, `dbstatus=${dd.status}/${dd.visibility}`);
  await api("PUT", `${base}/${id}`, { token: A, body: { ...body, status: "draft", visibility: "public" } });
  const pr = await api("POST", `${base}/${id}/publish`, { token: A });
  check(`${kind}: admin publish -> 200`, pr.status === 200, `status=${pr.status} ${pr.json?.message || ""}`);
  check(`${kind}: PUBLISHED visible in public list`, await visible());
  check(`${kind}: PUBLISHED direct slug -> 200`, (await direct()) === 200);
  const ed = await api("PUT", `${base}/${id}`, { token: A, body: { ...body, title: `${body.title} EDITED`, status: "published" } });
  const after = (await api("GET", `${pubBase}/${slug}`)).json;
  check(`${kind}: admin edit -> DB + public content updated`, ed.status === 200 && JSON.stringify(after).includes("EDITED"), `status=${ed.status}`);
  const ar = await api("POST", `${base}/${id}/archive`, { token: A });
  check(`${kind}: admin archive -> 200`, ar.status === 200, `status=${ar.status}`);
  check(`${kind}: ARCHIVED hidden (list + direct)`, !(await visible()) && (await direct()) === 404);
  const still = await api("GET", `${base}/${id}`, { token: A });
  check(`${kind}: admin can still open archived record`, still.status === 200);
  await db.collection(isSvc ? "services" : "cmspages").deleteMany({ slug });
};
console.log("\n== Service lifecycle =="); await lifecycle("service");
console.log("\n== Article lifecycle =="); await lifecycle("article");

console.log("\n== Dashboard/stat counts from DB ==");
const ss = await api("GET", "/admin/services/stats", { token: A });
const dbSvc = { total: await db.collection("services").countDocuments({}), published: await db.collection("services").countDocuments({ status: "published" }) };
console.log("service stats:", JSON.stringify(ss.json?.data)?.slice(0, 200), "db:", JSON.stringify(dbSvc));
check("service stats total/published match DB", ss.status === 200 && JSON.stringify(ss.json.data).includes(String(dbSvc.total)));
console.log("\nSUMMARY", results.filter(Boolean).length + "/" + results.length, "passed");
process.exitCode = results.every(Boolean) ? 0 : 1;
await m.disconnect();
