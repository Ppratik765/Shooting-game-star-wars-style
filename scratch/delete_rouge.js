import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envContent = fs.readFileSync(path.join(__dirname, '../.env'), 'utf-8');
const urlMatch = envContent.match(/UPSTASH_REDIS_REST_URL="?([^"\n\r]+)"?/);
const tokenMatch = envContent.match(/UPSTASH_REDIS_REST_TOKEN="?([^"\n\r]+)"?/);

if (!urlMatch || !tokenMatch) {
  console.error('Failed to parse .env file');
  process.exit(1);
}

const url = urlMatch[1];
const token = tokenMatch[1];

async function run() {
  const rougePayload = JSON.stringify({
    name: "ROUGE 1",
    time: 98.82579999980933,
    device: "Desktop",
    date: 1779949067958,
    id: "i8urjc99owmpp3pupi"
  });

  const bodyCommand = ['ZREM', 'leaderboard', rougePayload];

  console.log('Deleting ROUGE 1 (25 kills) entry...');
  const response = await fetch(`${url}/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyCommand)
  });

  const data = await response.json();
  console.log('Response:', data);
}

run().catch(console.error);
