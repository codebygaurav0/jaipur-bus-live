const backend = require("../server");

const app = typeof backend === "function" ? backend : backend.app;

if (typeof app !== "function") {
  throw new TypeError("Vercel handler could not load the Express app");
}

module.exports = app;
