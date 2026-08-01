import fs from 'fs';
import { execSync } from 'child_process';

const envContent = fs.readFileSync('.env.production.local', 'utf8');

const vars = {};
let currentKey = null;
let currentValue = '';

for (const line of envContent.split('\n')) {
  const trimmed = line.trimEnd();
  if (!trimmed || trimmed.startsWith('#')) continue;
  
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    // Save previous key
    if (currentKey) {
      vars[currentKey] = currentValue.trim();
    }
    currentKey = trimmed.substring(0, eqIdx).trim();
    currentValue = trimmed.substring(eqIdx + 1);
  } else if (currentKey) {
    currentValue += '\n' + trimmed;
  }
}
if (currentKey) {
  vars[currentKey] = currentValue.trim();
}

console.log('Found env vars:', Object.keys(vars));

// Write each env var to a temp file and use vercel env add
for (const [key, value] of Object.entries(vars)) {
  try {
    const tmpFile = `tmp_env_${key}.txt`;
    fs.writeFileSync(tmpFile, value, 'utf8');
    
    // Use vercel env add with piped input
    const result = execSync(`cmd /c "type ${tmpFile} | vercel env add ${key} production 2>&1"`, {
      encoding: 'utf8',
      timeout: 30000
    });
    console.log(`✓ Set ${key}:`, result.trim().slice(0, 80));
    
    fs.unlinkSync(tmpFile);
  } catch (e) {
    console.error(`✗ Failed ${key}:`, e.message.slice(0, 100));
  }
}

console.log('\nDone! Now redeploying...');
try {
  const deployResult = execSync('cmd /c "vercel --prod --yes 2>&1"', {
    encoding: 'utf8',
    timeout: 300000,
    cwd: process.cwd()
  });
  console.log(deployResult);
} catch(e) {
  console.error('Deploy error:', e.message.slice(0, 200));
}
