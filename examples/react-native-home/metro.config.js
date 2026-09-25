const fs=require('fs');
const path=require('path');
const {getDefaultConfig}=require('expo/metro-config');
const config=getDefaultConfig(__dirname);
config.watchFolders=[fs.realpathSync(path.join(__dirname,'node_modules'))];
config.resolver.nodeModulesPaths=[path.join(__dirname,'node_modules')];
module.exports=config;
