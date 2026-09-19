const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Ignore CMake build artifacts — Metro watcher ko ye folders crash karte hain
config.watchFolders = [__dirname];
config.resolver.blockList = [
  /node_modules\/.*\/android\/\.cxx\/.*/,
  /node_modules\/.*\/android\/build\/.*/,
  /android\/\.cxx\/.*/,
  /android\/build\/.*/,
];

module.exports = config;
