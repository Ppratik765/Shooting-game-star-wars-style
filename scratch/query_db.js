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
  const response = await fetch(`${url}/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(['ZRANGE', 'leaderboard', 0, -1, 'WITHSCORES'])
  });

  const checkData = await response.json();
  const rawResult = checkData.result || [];
  console.log('Leaderboard count:', rawResult.length / 2);
  for (let i = 0; i < rawResult.length; i += 2) {
    console.log(`Score: ${rawResult[i+1]}, Payload: ${rawResult[i]}`);
  }
}

run().catch(console.error);
