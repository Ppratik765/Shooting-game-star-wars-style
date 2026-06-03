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
  const oldPriyanhsuPayload = JSON.stringify({
    name: "PRIYANSHU",
    time: 170.82189499829292,
    device: "Desktop",
    date: 1779878461387,
    id: "j4qlkhclw4mpnxoibv"
  });

  const oldQwertyPayload = JSON.stringify({
    name: "QWERTY",
    time: 563.0412800009011,
    device: "Desktop",
    date: 1779901438276,
    id: "3amhi028w9pmpobczer"
  });

  const newPriyanshuPayload = JSON.stringify({
    name: "PRIYANSHU",
    time: 563.0412800009011,
    device: "Desktop",
    date: 1779901438276,
    id: "3amhi028w9pmpobczer"
  });

  // Upstash pipeline
  const bodyCommand = [
    ['ZREM', 'leaderboard', oldPriyanhsuPayload],
    ['ZREM', 'leaderboard', oldQwertyPayload],
    ['ZADD', 'leaderboard', 155, newPriyanshuPayload]
  ];

  console.log('Sending transaction pipeline to Upstash...');
  const response = await fetch(`${url}/pipeline`, {
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
