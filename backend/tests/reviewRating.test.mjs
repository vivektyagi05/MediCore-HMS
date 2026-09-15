import { computeAverageRating } from "../services/reviewRatingService.js";
import assert from "assert";

assert.strictEqual(computeAverageRating([]), 0);
console.log("PASS: empty reviews -> 0");

assert.strictEqual(computeAverageRating([{ rating: 5 }, { rating: 3 }]), 4);
console.log("PASS: simple average");

assert.strictEqual(computeAverageRating([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), 4.3);
console.log("PASS: rounds to 1 decimal, matches prior behavior (toFixed(1))");

console.log("ALL REVIEW RATING TESTS PASSED");
