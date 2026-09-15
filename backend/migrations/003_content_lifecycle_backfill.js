import { connectDB } from "../config/db.js";
import Service from "../models/Service.js";
import CMSPage from "../models/CMSPage.js";

const run = async () => {
  await connectDB();
  const serviceResult = await Service.updateMany(
    { status: { $exists: false } },
    [{ $set: { status: { $cond: ["$isActive", "published", "archived"] }, visibility: "public" } }],
  );
  const articleResult = await CMSPage.updateMany(
    { status: { $exists: false } },
    [{ $set: { status: { $cond: ["$isPublished", "published", "draft"] }, visibility: "public", contentType: "article" } }],
  );
  console.log(JSON.stringify({ services: serviceResult.modifiedCount, articles: articleResult.modifiedCount }));
  process.exit(0);
};

if (process.argv[1]?.endsWith("003_content_lifecycle_backfill.js")) run().catch((error) => { console.error(error); process.exit(1); });
export { run };
