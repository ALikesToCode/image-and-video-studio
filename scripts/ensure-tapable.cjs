const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const tapableSource = path.join(root, "node_modules", "tapable");
const enhancedResolveNodeModules = path.join(
  root,
  "node_modules",
  "enhanced-resolve",
  "node_modules"
);
const tapableTarget = path.join(enhancedResolveNodeModules, "tapable");

if (!fs.existsSync(tapableSource)) {
  process.exit(0);
}

fs.mkdirSync(enhancedResolveNodeModules, { recursive: true });

if (!fs.existsSync(tapableTarget)) {
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(tapableSource, tapableTarget, linkType);
}
