const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const tapableSource = path.join(root, "node_modules", "tapable");
const enhancedResolveRoot = path.join(root, "node_modules", "enhanced-resolve");
const enhancedResolveNodeModules = path.join(
  enhancedResolveRoot,
  "node_modules"
);

if (!fs.existsSync(tapableSource)) {
  process.exit(0);
}

const pathExists = (value) => {
  try {
    fs.lstatSync(value);
    return true;
  } catch {
    return false;
  }
};

const ensureTapableLink = (basePath) => {
  if (!basePath || !fs.existsSync(basePath)) return;
  const nodeModulesPath = path.join(basePath, "node_modules");
  const tapableTarget = path.join(nodeModulesPath, "tapable");
  fs.mkdirSync(nodeModulesPath, { recursive: true });

  if (pathExists(tapableTarget)) return;
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(tapableSource, tapableTarget, linkType);
};

ensureTapableLink(enhancedResolveRoot);
try {
  const enhancedResolveReal = fs.realpathSync(enhancedResolveRoot);
  if (enhancedResolveReal !== enhancedResolveRoot) {
    ensureTapableLink(enhancedResolveReal);
  }
} catch {
  // Ignore realpath errors.
}
