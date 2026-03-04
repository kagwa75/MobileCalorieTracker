const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Standalone app: only watch this project, not the user home/old monorepo.
config.watchFolders = [projectRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;
