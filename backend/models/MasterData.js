import mongoose from "mongoose";

const masterDataSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["specialization", "state", "district", "city"],
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    normalizedName: { type: String, required: true, trim: true, lowercase: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "MasterData", default: null, index: true },
    active: { type: Boolean, default: true, index: true },
    source: { type: String, enum: ["seed", "lgd", "legacy"], default: "legacy", index: true },
  },
  { timestamps: true },
);

masterDataSchema.index(
  { kind: 1, parentId: 1, normalizedName: 1 },
  { unique: true },
);

// Mongoose 9 removed the callback-style `next` argument for document
// middleware: `function (next) { ...; next(); }` throws "next is not a function"
// on every create()/save()/insertMany(), and insertMany({ordered:false})
// swallowed that error and reported zero inserted rows. Keep hooks synchronous
// (throw to fail validation) and never take a `next` parameter.
masterDataSchema.pre("validate", function normalizeMasterName() {
  this.name = String(this.name || "").trim();
  this.normalizedName = this.name.toLowerCase();
});

const MasterData = mongoose.model("MasterData", masterDataSchema);

export default MasterData;
