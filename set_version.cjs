const fs = require('fs');
const path = require('path');

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const version = packageJson.version;

console.log(`Updating version to ${version} in src/index.ts`);

// Read the src/index.ts file
const indexPath = path.join(__dirname, 'src', 'cli.ts');
const indexContent = fs.readFileSync(indexPath, 'utf8');

// Replace the version line
const updatedContent = indexContent.replace(
  /const PACKAGE_VERSION = ['"].*['"];/,
  `const PACKAGE_VERSION = '${version}';`
);

// Write back to the file
fs.writeFileSync(indexPath, updatedContent);

console.log('Version updated successfully!'); 