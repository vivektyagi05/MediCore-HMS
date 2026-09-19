import { connectDB, disconnectDB } from "../config/db.js";
import { bootstrapMasterDataFromDoctors } from "../services/masterDataService.js";

const run = async () => {
  await connectDB();
  const result = await bootstrapMasterDataFromDoctors();
  console.log(JSON.stringify(result));
};

if (process.argv[1]?.endsWith("004_master_data_backfill.js")) {
  run()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}

export { run };
