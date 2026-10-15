// Local release signing without EAS.
// Appends a signing block to android/app/build.gradle on every prebuild (so `prebuild --clean` can't lose it).
// Credentials come from Gradle properties — put them in ~/.gradle/gradle.properties (outside the repo):
//
//   FILETOOLKIT_STORE_FILE=/Users/you/keys/filetoolkit.jks
//   FILETOOLKIT_STORE_PASSWORD=...
//   FILETOOLKIT_KEY_ALIAS=filetoolkit
//   FILETOOLKIT_KEY_PASSWORD=...
//
// If they're missing, release builds fall back to the debug key (fine for sideloading).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @filetoolkit/release-signing';

const BLOCK = `
${MARKER}
android {
    signingConfigs {
        release {
            if (project.hasProperty('FILETOOLKIT_STORE_FILE')) {
                storeFile file(project.property('FILETOOLKIT_STORE_FILE'))
                storePassword project.property('FILETOOLKIT_STORE_PASSWORD')
                keyAlias project.property('FILETOOLKIT_KEY_ALIAS')
                keyPassword project.property('FILETOOLKIT_KEY_PASSWORD')
            }
        }
    }
    buildTypes {
        release {
            signingConfig project.hasProperty('FILETOOLKIT_STORE_FILE') ? signingConfigs.release : signingConfigs.debug
        }
    }
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: expected a Groovy build.gradle');
    }
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += BLOCK;
    }
    return cfg;
  });
};
