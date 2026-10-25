module.exports = {
  preset: '@react-native/jest-preset',
  // The preset compiles .js/.ts/.tsx only; most screens here are .jsx.
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp)$': require.resolve(
      '@react-native/jest-preset/jest/assetFileTransformer.js',
    ),
  },
  // The preset's list plus React Navigation, which ships ES modules
  // (chatStackRenders.test.js mounts the real native stack).
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native[^/]*|@react-native(-community)?|@react-navigation|react-freeze)/)',
  ],
};
